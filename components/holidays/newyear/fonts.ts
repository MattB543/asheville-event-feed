import { Josefin_Sans, Limelight } from 'next/font/google';

// Loaded only by the New Year's page: an art deco face for its headings and the countdown
export const limelight = Limelight({ subsets: ['latin'], weight: '400', display: 'swap' });

// The page's own text: a geometric face from the same era as Limelight
export const josefin = Josefin_Sans({ subsets: ['latin'], display: 'swap' });
