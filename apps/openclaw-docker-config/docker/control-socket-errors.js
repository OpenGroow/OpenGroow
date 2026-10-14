"use strict";

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

module.exports = { toErrorMessage };
