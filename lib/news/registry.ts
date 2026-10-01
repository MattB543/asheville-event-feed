/**
 * Every news source the pipeline runs, as an explicit list. Nothing scans the
 * sources directory: add a module here to turn it on.
 */

import newsnow828 from './sources/828newsnow';
import ashevillecity from './sources/ashevillecity';
import avlcouncilagenda from './sources/avlcouncilagenda';
import avlwatchdog from './sources/avlwatchdog';
import beacontribune from './sources/beacontribune';
import biltmoreforesttown from './sources/biltmoreforesttown';
import blackmountainnews from './sources/blackmountainnews';
import blackmountaintown from './sources/blackmountaintown';
import bluebanner from './sources/bluebanner';
import bpr from './sources/bpr';
import buncombecommission from './sources/buncombecommission';
import buncombecounty from './sources/buncombecounty';
import buncombeschools from './sources/buncombeschools';
import carolinapublicpress from './sources/carolinapublicpress';
import flyavl from './sources/flyavl';
import foxcarolina from './sources/foxcarolina';
import googlenews from './sources/googlenews';
import missionhealth from './sources/missionhealth';
import montreattown from './sources/montreattown';
import mountainx from './sources/mountainx';
import reddit from './sources/reddit';
import uncanews from './sources/uncanews';
import urbannews from './sources/urbannews';
import wakeupasheville from './sources/wakeupasheville';
import weavervilletown from './sources/weavervilletown';
import wlos from './sources/wlos';
import wncbusiness from './sources/wncbusiness';
import type { NewsSourceModule } from './types';

export const NEWS_SOURCES: NewsSourceModule[] = [
  newsnow828,
  ashevillecity,
  avlcouncilagenda,
  avlwatchdog,
  beacontribune,
  biltmoreforesttown,
  blackmountainnews,
  blackmountaintown,
  bluebanner,
  bpr,
  buncombecommission,
  buncombecounty,
  buncombeschools,
  carolinapublicpress,
  flyavl,
  foxcarolina,
  googlenews,
  missionhealth,
  montreattown,
  mountainx,
  reddit,
  uncanews,
  urbannews,
  wakeupasheville,
  weavervilletown,
  wlos,
  wncbusiness,
];
