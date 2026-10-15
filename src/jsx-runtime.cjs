// SPDX-License-Identifier: MIT
'use strict';
const { createElement, Fragment } = require('./ui.cjs');
function jsx(type, props, _key) { return createElement(type, props); }
module.exports = { jsx, jsxs: jsx, jsxDEV: jsx, Fragment };
