import { renderRows } from './mandelbrot.js';

self.onmessage = e => {
  const { id, grid, rowStart, rowEnd } = e.data;
  const out = renderRows(grid, rowStart, rowEnd);
  self.postMessage({ id, rowStart, rowEnd, out }, [out.buffer]);
};
