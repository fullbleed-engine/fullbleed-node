// SPDX-License-Identifier: MIT
// Browser builds preserve this import so all entrypoints share one node identity.
import { createElement, Fragment } from './ui.js';
export { Fragment };
export function jsx(type, props, _key) { return createElement(type, props); }
export const jsxs = jsx;
export const jsxDEV = jsx;
