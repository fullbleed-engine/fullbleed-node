// SPDX-License-Identifier: MIT
import { renderPdf } from 'fullbleed/cloudflare';
import { invoiceHandler } from './handler.mjs';

export default invoiceHandler(renderPdf);
