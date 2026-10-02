// SPDX-License-Identifier: MIT
const fixture = (name, gradient, probes, backdrop = 'white') => ({
  name,
  pages: 1,
  html: '<div></div>',
  css: `@page {size:100pt 100pt;margin:0} body {margin:0;background:${backdrop}} div {width:100pt;height:100pt;background:${gradient}}`,
  probes,
});

export const gradientFixtures = [
  fixture('linear-gradient', 'linear-gradient(90deg,red,blue)', [[25, 50, [190, 0, 65]], [75, 50, [62, 0, 193]]]),
  fixture('translucent-gradient', 'linear-gradient(90deg,rgba(255,0,0,.5),rgba(0,0,255,.5))', [[25, 50, [95, 128, 33]], [75, 50, [31, 128, 97]]], '#00ff00'),
  fixture('hard-radial-gradient', 'radial-gradient(circle 40pt at 50pt 50pt,red 0%,red 50%,blue 50%,blue 100%)', [[60, 50, [255, 0, 0]], [80, 50, [0, 0, 255]]]),
];
