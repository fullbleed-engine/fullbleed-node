# Radial-gradient endpoint colors and opacity

Fullbleed 0.8.7 embeds engine 2.5.43. Radial gradients preserve the final color
and opacity outside the ending shape, including a color change at the last stop.

```css
.seal {
  background: radial-gradient(circle 30pt at 50pt 50pt,
    red, gold 100%, blue 100%);
}
```

The exterior is blue. A transparent final stop exposes the background beneath
the gradient. The update also corrects zero-width PDF stitching intervals.
The JavaScript API and worker/process isolation options are unchanged.

The installed-package checks cover twelve inputs in both isolation modes.
They inspect saved PDF bounds and compare PDF bytes, native pixels and PDFium
pixels with the qualified core 2.5.43 reference. The actual public 0.8.6 control
reproduces eighteen color failures and twenty invalid-stitching cases. Four
smooth/repeating controls retain their output exactly. These checks cover the
named fixtures; they are not a general CSS or PDF conformance claim.
