import path from 'path';
import { createTomorrowEmailBuilder, getFirstName } from './tomorrow-email';

export { getFirstName };

export const buildVibeTomorrowEmail = createTomorrowEmailBuilder({
  subject: 'Switchyards Vibe Match is Saturday',
  templatePath: path.join(process.cwd(), 'claude', 'email-copy-vibe-tomorrow.md'),
  draftOnlyLine:
    "(I see you started your survey but didn't finish it. You can still submit now! https://www.avlgo.com/vibe)",
  headerTitle: 'Switchyards Vibe Match is Saturday',
});
