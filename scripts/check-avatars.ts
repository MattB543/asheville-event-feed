import { db } from '../lib/db';
import { curatorProfiles } from '../lib/db/schema';

async function check() {
  const profiles = await db.select({
    slug: curatorProfiles.slug,
    displayName: curatorProfiles.displayName,
    showProfilePicture: curatorProfiles.showProfilePicture,
    avatarUrl: curatorProfiles.avatarUrl,
  }).from(curatorProfiles).limit(5);

  console.log('Curator profiles with avatar info:');
  console.log(JSON.stringify(profiles, null, 2));
  process.exit(0);
}

check();
