<?php
// Optional: copy to config.local.php. The defaults work without this file.
return [
    // Absolute, persistent directory writable by PHP; keep it outside the webroot.
    // 'data_dir' => '/var/lib/webhooktest',
    // Set behind a reverse proxy or when automatic URL detection is unsuitable.
    // 'base_url' => 'https://hooks.example.com',
    'max_body_bytes' => 10 * 1024 * 1024,
];
