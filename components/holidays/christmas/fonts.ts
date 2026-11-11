import { Bodoni_Moda } from 'next/font/google';

// Loaded only by the Christmas page: the calendar's door numbers and headings
export const bodoni = Bodoni_Moda({
  subsets: ['latin'],
  display: 'swap',
  axes: ['opsz'],
  style: ['normal', 'italic'],
});
