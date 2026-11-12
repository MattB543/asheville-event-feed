import { Fraunces } from 'next/font/google';

// Loaded only by the Thanksgiving page; variable, so headings and menu lines share one file
export const fraunces = Fraunces({ subsets: ['latin'], display: 'swap', axes: ['SOFT', 'opsz'] });
