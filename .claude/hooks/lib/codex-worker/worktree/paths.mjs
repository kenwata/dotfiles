// @ts-check

// worktree のパスに関するファイルシステム述語を持つ。

import fs from "node:fs";
import { hasErrorCode } from "../git.mjs";

/** Return whether a path has any filesystem entry, including a dangling symlink.
 * @param {string} target
 * @returns {boolean}
 */
export function pathExists(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return false;
    throw error;
  }
}

/** Return whether a path currently resolves to a directory.
 * @param {string} target
 * @returns {boolean}
 */
export function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return false;
    throw error;
  }
}

/** Return whether a path itself is a directory and not a symbolic link.
 * @param {string} target
 * @returns {boolean}
 */
export function isRealDirectory(target) {
  try {
    return fs.lstatSync(target).isDirectory();
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return false;
    throw error;
  }
}

/** Return whether a path itself is a symbolic link.
 * @param {string} target
 * @returns {boolean}
 */
export function isSymbolicLink(target) {
  try {
    return fs.lstatSync(target).isSymbolicLink();
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return false;
    throw error;
  }
}
