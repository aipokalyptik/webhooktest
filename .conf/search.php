<?php
declare(strict_types=1);

// Pinned upstream sources with the documented string-comparison patch. No Composer installation is needed on a host.
spl_autoload_register(static function (string $class): void {
    $prefix = 'Flow\\JSONPath\\';
    if (str_starts_with($class, $prefix)) {
        $file = __DIR__ . '/vendor/softcreatr-jsonpath/src/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
        if (is_file($file)) require $file;
    }
});

final class SearchError extends RuntimeException {}

function search_regex(string $pattern, string $text): bool
{
    $result = @preg_match($pattern, $text);
    if ($result === false) {
        throw new SearchError('Regex could not run: ' . preg_last_error_msg() . '. Simplify the expression or narrow the search.');
    }
    return $result === 1;
}

function search_pattern(array $rule): string
{
    $pattern = $rule['value'];
    if ($rule['op'] === 'wildcard') {
        $compiled = '';
        for ($i = 0; $i < strlen($pattern); $i++) {
            $c = $pattern[$i];
            if ($c === '\\' && $i + 1 < strlen($pattern)) $compiled .= preg_quote($pattern[++$i], '~');
            else $compiled .= match ($c) { '*' => '.*', '?' => '.', default => preg_quote($c, '~') };
        }
        return '~\A' . $compiled . '\z~us' . ($rule['case'] ? '' : 'i');
    }
    // Pick a delimiter the expression cannot contain instead of altering regex escapes.
    foreach (['~', '#', '%', '!', ';', '`', "\x01"] as $delimiter) {
        if (!str_contains($pattern, $delimiter)) {
            return $delimiter . $pattern . $delimiter . 'u' . ($rule['case'] ? '' : 'i') . $rule['flags'];
        }
    }
    throw new SearchError('Regex contains every supported delimiter. Simplify the expression.');
}

// Upstream accepts an unfinished trailing bracket as a shorter path. Reject it
// before tokenization so a typing error can never silently broaden a search.
function validate_jsonpath_structure(string $path): void
{
    $stack = [];
    $quote = null;
    $escaped = false;
    for ($i = 0; $i < strlen($path); $i++) {
        $c = $path[$i];
        if ($quote !== null) {
            if ($escaped) $escaped = false;
            elseif ($c === "\\") $escaped = true;
            elseif ($c === $quote) $quote = null;
        } elseif ($c === '"' || $c === "'") $quote = $c;
        elseif ($c === '[' || $c === '(') $stack[] = $c;
        elseif ($c === ']' || $c === ')') {
            if (array_pop($stack) !== ($c === ']' ? '[' : '(')) throw new SearchError('JSONPath has mismatched brackets or parentheses.');
        }
    }
    if ($quote !== null || $stack) throw new SearchError('JSONPath has an unclosed quote, bracket, or parenthesis.');
}

function compile_search(string $raw, string $query = ''): array
{
    // Limits prevent an accidental pattern from monopolizing a PHP worker.
    ini_set('pcre.backtrack_limit', '100000');
    ini_set('pcre.recursion_limit', '1000');
    if (strlen($raw) > 6000) throw new SearchError('Advanced search is limited to 6,000 bytes.');
    if (strlen(http_build_query(['q' => $query, 'filters' => $raw], '', '&', PHP_QUERY_RFC3986)) > 7000) throw new SearchError('This search is too long for a portable link. Shorten the patterns or use fewer conditions.');
    try {
        $search = $raw === '' ? ['match' => 'all', 'rules' => []] : json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        throw new SearchError('Advanced search must be a JSON object.');
    }
    if (!is_array($search) || !in_array($search['match'] ?? null, ['all', 'any'], true)
        || !is_array($search['rules'] ?? null) || !array_is_list($search['rules']) || count($search['rules']) > 8) {
        throw new SearchError('Choose all or any and supply up to 8 search conditions.');
    }
    foreach ($search['rules'] as $index => &$rule) {
        $number = $index + 1;
        if (!is_array($rule)) throw new SearchError("Condition $number is invalid.");
        foreach (['scope', 'op', 'key', 'value', 'flags'] as $field) {
            $rule[$field] ??= '';
            if (!is_string($rule[$field]) || strlen($rule[$field]) > 500) throw new SearchError("Condition $number: fields must be text of at most 500 bytes.");
        }
        $rule['case'] ??= false;
        if (!is_bool($rule['case'])) throw new SearchError("Condition $number: match case must be true or false.");
        $scope = $rule['scope'];
        if (!in_array($scope, ['any', 'body', 'headers', 'header', 'query', 'parameter', 'json', 'method', 'url', 'path', 'content_type', 'id', 'ip', 'size', 'received'], true)) {
            throw new SearchError("Condition $number: unknown search field.");
        }
        $operators = match ($scope) {
            'size' => ['equals', 'gt', 'gte', 'lt', 'lte'],
            'received' => ['before', 'after'],
            default => ['contains', 'equals', 'wildcard', 'regex', 'exists', 'missing'],
        };
        if (!in_array($rule['op'], $operators, true)) throw new SearchError("Condition $number: this match mode is not available for this field.");
        if (in_array($scope, ['header', 'parameter', 'json'], true) && trim($rule['key']) === '') throw new SearchError("Condition $number: enter a field name or JSONPath.");
        if (!preg_match('/\A[m]{0,1}[s]{0,1}\z/', $rule['flags'])) throw new SearchError("Condition $number: regex flags may be m, s, or ms.");
        if ($scope === 'size') {
            if (!preg_match('/\A[0-9]{1,15}\z/', $rule['value'])) throw new SearchError("Condition $number: enter a nonnegative size in bytes.");
            $rule['number'] = (int) $rule['value'];
        }
        if ($scope === 'received') {
            if (!preg_match('/\A\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})\z/', $rule['value'])) throw new SearchError("Condition $number: use an ISO date with timezone, for example 2026-09-23T12:00:00Z.");
            try { $date = new DateTimeImmutable($rule['value']); }
            catch (Exception) { throw new SearchError("Condition $number: invalid date."); }
            if (DateTimeImmutable::getLastErrors() !== false) throw new SearchError("Condition $number: invalid date.");
            $rule['date'] = $date->format('U.u');
        }
        try {
            if ($scope === 'json') {
                validate_jsonpath_structure($rule['key']);
                if (!str_starts_with($rule['key'], '$')) throw new SearchError('JSONPath must start with $.');
                // Validate every token even when an inbox is empty or an earlier path has no matches.
                foreach ((new Flow\JSONPath\JSONPath())->parseTokens($rule['key']) as $token) {
                    $token->buildFilter(0)->filter([]);
                }
            }
            if (in_array($rule['op'], ['regex', 'wildcard'], true)) {
                $rule['pattern'] = search_pattern($rule);
                search_regex($rule['pattern'], '');
            }
        } catch (Flow\JSONPath\JSONPathException | SearchError $error) {
            throw new SearchError("Condition $number: " . $error->getMessage());
        }
    }
    unset($rule);
    $search['query'] = $query;
    $search['deadline'] = microtime(true) + 5;
    return $search;
}

function search_check_time(array $search): void
{
    if (microtime(true) > $search['deadline']) throw new SearchError('Search exceeded 5 seconds. Narrow the inbox or remove old captures and try again. No partial results are shown.');
}

function search_text(mixed $value): string
{
    return is_string($value) ? $value : json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
}

function search_query_values(string $query): array
{
    $values = [];
    foreach (explode('&', $query) as $part) {
        if ($part === '') continue;
        [$name, $value] = array_pad(explode('=', $part, 2), 2, '');
        $values[] = [urldecode($name), urldecode($value)];
    }
    return $values;
}

function search_values(array $record, array $rule, array &$cache): array
{
    $scope = $rule['scope'];
    if ($scope === 'json') {
        if (!array_key_exists('json_ok', $cache)) {
            try {
                // Retain oversized integer IDs as digit strings instead of rounding to floats.
                $cache['json'] = json_decode($record['body'] ?? '', false, 512, JSON_THROW_ON_ERROR | JSON_BIGINT_AS_STRING);
                $cache['json_ok'] = true;
            } catch (JsonException) { $cache['json_ok'] = false; }
        }
        // Missing is meaningful only inside valid JSON; a binary/text body is not a missing JSON field.
        if (!$cache['json_ok']) return ['applicable' => false, 'values' => []];
        try { $values = (new Flow\JSONPath\JSONPath($cache['json']))->find($rule['key'])->getData(); }
        catch (Flow\JSONPath\JSONPathException $error) { throw new SearchError('JSONPath: ' . $error->getMessage()); }
        return ['applicable' => true, 'values' => array_map(fn ($value) => [$rule['key'], search_text($value)], $values)];
    }
    $values = [];
    if (in_array($scope, ['any', 'headers', 'header'], true)) {
        foreach ($record['headers'] as $name => $value) {
            if ($scope === 'header' && strcasecmp($name, $rule['key']) !== 0) continue;
            $values[] = [$name, $value];
            if ($scope !== 'header') $values[] = ['Header name', $name];
        }
    }
    if (in_array($scope, ['query', 'parameter'], true)) {
        foreach (search_query_values($record['query']) as [$name, $value]) {
            if ($scope === 'parameter' && $name !== $rule['key']) continue;
            $values[] = ['Query: ' . $name, $value];
            if ($scope === 'query') $values[] = ['Query name', $name];
        }
    }
    $fields = ['id' => 'id', 'method' => 'method', 'url' => 'url', 'path' => 'uri', 'content_type' => 'content_type', 'body' => 'body', 'ip' => 'remote_addr', 'size' => 'size', 'received' => 'received_at'];
    foreach ($fields as $field => $key) {
        if (($scope === $field || $scope === 'any') && isset($record[$key])) $values[] = [$field, (string) $record[$key]];
    }
    return ['applicable' => true, 'values' => $values];
}

function search_rule(array $record, array $rule, array &$cache): ?array
{
    $selection = search_values($record, $rule, $cache);
    if (!$selection['applicable']) return null;
    $values = $selection['values'];
    if (in_array($rule['op'], ['exists', 'missing'], true)) {
        $matches = $rule['op'] === 'exists' ? count($values) > 0 : count($values) === 0;
        return $matches ? ['field' => $rule['key'] ?: $rule['scope'], 'value' => $rule['op'] === 'exists' ? 'Present' : 'Missing'] : null;
    }
    foreach ($values as [$label, $value]) {
        $offset = 0;
        $matched = match ($rule['op']) {
            'contains' => ($offset = ($rule['case'] ? strpos($value, $rule['value']) : stripos($value, $rule['value']))) !== false,
            'equals' => $rule['case'] ? $value === $rule['value'] : strcasecmp($value, $rule['value']) === 0,
            'wildcard', 'regex' => search_regex($rule['pattern'], $value),
            'gt' => (int) $value > $rule['number'],
            'gte' => (int) $value >= $rule['number'],
            'lt' => (int) $value < $rule['number'],
            'lte' => (int) $value <= $rule['number'],
            'before' => (new DateTimeImmutable($value))->format('U.u') < $rule['date'],
            'after' => (new DateTimeImmutable($value))->format('U.u') > $rule['date'],
        };
        if ($rule['scope'] === 'size' && $rule['op'] === 'equals') $matched = (int) $value === $rule['number'];
        if ($matched) {
            $start = max(0, (int) $offset - 45);
            return ['field' => $label, 'value' => ($start ? '…' : '') . substr($value, $start, 220) . (strlen($value) > $start + 220 ? '…' : '')];
        }
    }
    return null;
}

function match_search(array $record, array $search): ?array
{
    search_check_time($search);
    $cache = [];
    $evidence = [];
    if ($search['query'] !== '') {
        $hit = search_rule($record, ['scope' => 'any', 'op' => 'contains', 'value' => $search['query'], 'case' => false], $cache);
        if ($hit === null) return null;
        $evidence[] = $hit;
    }
    $matched = 0;
    foreach ($search['rules'] as $rule) {
        $hit = search_rule($record, $rule, $cache);
        if ($hit !== null) { $matched++; $evidence[] = $hit; }
        elseif ($search['match'] === 'all') return null;
        search_check_time($search);
    }
    if ($search['rules'] && $search['match'] === 'any' && !$matched) return null;
    return array_slice($evidence, 0, 2);
}
