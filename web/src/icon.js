// A white top-view airliner silhouette (nose pointing up / north) drawn onto a
// canvas. We return the canvas ELEMENT (not a data URL) so deck.gl's IconLayer
// uses it as a ready texture source synchronously — recreating the layer every
// frame would otherwise restart an async URL load that never settles. The white
// shape is tinted per-aircraft via getColor (mask: true).
export function makePlaneIcon() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff';
  x.beginPath();
  x.moveTo(32, 5);
  x.lineTo(35, 27);
  x.lineTo(61, 42);
  x.lineTo(61, 47);
  x.lineTo(35, 35);
  x.lineTo(34, 51);
  x.lineTo(45, 59);
  x.lineTo(45, 62);
  x.lineTo(32, 56);
  x.lineTo(19, 62);
  x.lineTo(19, 59);
  x.lineTo(30, 51);
  x.lineTo(29, 35);
  x.lineTo(3, 47);
  x.lineTo(3, 42);
  x.lineTo(29, 27);
  x.closePath();
  x.fill();
  return c;
}
