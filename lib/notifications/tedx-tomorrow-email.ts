import path from 'path';
import { createTomorrowEmailBuilder, getFirstName } from './tomorrow-email';

export { getFirstName };

export const buildTedxTomorrowEmail = createTomorrowEmailBuilder({
  subject: 'Tomorrow is TEDxAsheville',
  templatePath: path.join(process.cwd(), 'claude', 'email-copy-2.md'),
  draftOnlyLine:
    "(I see you started your submission, but didn't finish it. Submit it now! https://www.avlgo.com/tedx)",
  headerTitle: 'Tomorrow is TEDxAsheville',
});
