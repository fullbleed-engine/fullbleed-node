// SPDX-License-Identifier: MIT
import './globals.css';

export const metadata = {
  title: 'A better PDF download | Fullbleed + Next.js',
  description: 'A runnable Next.js starter serving a designed invoice with Fullbleed. Fictional sample data.',
};

export default function Layout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
