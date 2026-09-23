"use strict";
importScripts("index.php?asset=binary-core.js");
let bytes;
self.onmessage = ({ data }) => {
  if (data.bytes) {
    bytes = data.bytes;
    return;
  }
  const { needle, start, direction, sequence } = data;
  try {
    let index = BinaryData.find(bytes, needle, start, direction);
    let wrapped = false;
    if (index < 0) {
      index = BinaryData.find(
        bytes,
        needle,
        direction > 0 ? 0 : bytes.length - 1,
        direction,
      );
      wrapped = index >= 0;
    }
    self.postMessage({ sequence, index, wrapped });
  } catch (error) {
    self.postMessage({ sequence, error: error.message });
  }
};
