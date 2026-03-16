import type { Metadata } from 'next';
import MatchingLandingPage from '@/components/matching/MatchingLandingPage';
import { getMatchingProgramConfig } from '@/lib/matching/programs';

const config = getMatchingProgramConfig('vibe');

export const metadata: Metadata = {
  title: 'Switchyards Vibe Match | AVL GO',
  description: config.landingDescription,
  robots: {
    index: false,
    follow: false,
  },
};

export default function VibeLandingRoute() {
  return <MatchingLandingPage program="vibe" />;
}
