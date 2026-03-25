export const MATCHING_PROGRAMS = ['tedx', 'vibe'] as const;

export type MatchingProgram = (typeof MATCHING_PROGRAMS)[number];

export const DEFAULT_PROGRAM: MatchingProgram = 'tedx';

export interface MatchingSurveyPhaseConfig {
  key: 'phase1' | 'phase2';
  title: string;
  description: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  hideHeader?: boolean;
}

export interface MatchingProgramConfig {
  program: MatchingProgram;
  path: `/${MatchingProgram}`;
  shortName: string;
  landingTitle: string;
  landingDescription: string;
  landingEyebrow: string;
  landingBody: string[];
  onboardingTitle: string;
  onboardingDescription: string;
  introHeading: string;
  introLead: string;
  ideaHeading: string;
  ideaBody: string;
  outcomeHeading: string;
  outcomeBody: string;
  privacyHeading: string;
  privacyPoints: string[];
  introClosing: string;
  consentDescription: string;
  consentStatement: string;
  contextTitle: string;
  contextDescription: string;
  questionsTitle: string;
  questionsDescription: string;
  surveyPhases: MatchingSurveyPhaseConfig[];
  oneAnswerHint: string;
  betterAnswerHint: string;
  confirmationBody: string;
  confirmationSteps: string[];
  confirmationEditNote: string;
  backLabel: string;
  profileTitle: string;
  eventCtaLabel: string;
  flowPageTitlePrefix: string;
  flowPageDescription: string;
  landingSource: string;
  exampleMatchImage?: string;
  matchesEvent: (event: { title?: string | null; organizer?: string | null }) => boolean;
}

function includesNormalized(value: string | null | undefined, needle: string): boolean {
  return value?.toLowerCase().includes(needle) ?? false;
}

export const MATCHING_PROGRAM_CONFIGS: Record<MatchingProgram, MatchingProgramConfig> = {
  tedx: {
    program: 'tedx',
    path: '/tedx',
    shortName: 'TEDx',
    landingTitle: 'Find Your People at TEDxAsheville',
    landingDescription: 'Find your people at TEDxAsheville.',
    landingEyebrow: 'Get matched with the attendees you will actually want to meet.',
    landingBody: [
      'This private pilot helps attendees discover stronger 1:1 conversations before the event.',
      'Share as much or as little as you want, but the more you share, the better your matches will be.',
      'Your specific answers stay private. We only use your data to build better match recommendations.',
    ],
    onboardingTitle: 'TEDx Matching Profile',
    onboardingDescription: 'TEDxAsheville attendee matching setup flow.',
    introHeading: 'How This Works',
    introLead:
      'We are building something special for TEDxAsheville: a way to connect you with the attendees you will actually click with.',
    ideaHeading: 'The Idea',
    ideaBody:
      'Share a bit about yourself, your interests, and what makes you tick. AI reads your input and finds people you are likely to have great conversations with.',
    outcomeHeading: 'What You Get',
    outcomeBody:
      'Before the event, you will receive a personalized list of people to meet with conversation starters to make introductions easier.',
    privacyHeading: 'Your Privacy',
    privacyPoints: [
      'Your specific answers are not shown directly to other attendees.',
      'Your data is used only for this matching pilot.',
      'You control what you share. Most fields are optional.',
    ],
    introClosing:
      'The more you share, the better your matches. Even 5 minutes of thoughtful input can help.',
    consentDescription: 'Confirm your name and opt in to AI-powered matching.',
    consentStatement:
      'I understand my profile data will be analyzed by AI and used to match me with other TEDxAsheville attendees. My specific answers are not shared directly.',
    contextTitle: 'Share Some Context',
    contextDescription: 'Everything is optional. More context leads to better matches.',
    questionsTitle: 'A Few Questions',
    questionsDescription: 'Every question is optional. Answer the ones that resonate with you.',
    surveyPhases: [
      {
        key: 'phase1',
        title: 'Questions',
        description: 'Answer whichever prompts feel useful.',
        defaultOpen: true,
        hideHeader: true,
      },
    ],
    oneAnswerHint:
      'You can submit with one answer, but 2-3 thoughtful answers improves match quality.',
    betterAnswerHint: 'You can submit now, but 2-3 answers usually creates better matches.',
    confirmationBody:
      'Your profile has been submitted. We will analyze it and use it to generate your TEDx matches.',
    confirmationSteps: [
      'We analyze your profile details and answers.',
      'We identify your strongest conversation matches.',
      'You receive your personalized list before TEDxAsheville.',
    ],
    confirmationEditNote: 'You can still edit your profile until submissions are locked.',
    backLabel: 'Back to TEDx',
    profileTitle: 'TEDx Matching Profile',
    eventCtaLabel: 'Open TEDx Matching',
    flowPageTitlePrefix: 'TEDx Matching',
    flowPageDescription: 'TEDxAsheville attendee matching setup flow.',
    landingSource: 'tedx_landing',
    matchesEvent: ({ title, organizer }) =>
      includesNormalized(title, 'tedx') || includesNormalized(organizer, 'tedx'),
  },
  vibe: {
    program: 'vibe',
    path: '/vibe',
    shortName: 'Vibe Match',
    landingTitle: 'Switchyards Vibe Match',
    landingDescription: 'Find the people you will actually want to meet at Switchyards.',
    landingEyebrow: '',
    landingBody: [
      'Switchyards Vibe Match is a meetup for Switchyards members and guests on Sat April 11th at 4:30 PM.',
      "Answer a short survey about yourself. We'll use AI to match you with 3 attendees you'd vibe with. Then at the event you will have three 10 min conversations with your matches plus plenty of time to mingle.",
      'The survey is fun and introspective. All questions are optional, but the more you share the better your matches will be. Use desktop over mobile if possible.',
      'Your raw answers stay private. They are used only to build stronger introductions and matches for this event (example below). Questions? Email hi@avlgo.com',
    ],
    onboardingTitle: 'Switchyards Vibe Match',
    onboardingDescription: 'Switchyards Vibe Match attendee matching setup flow.',
    introHeading: '',
    introLead:
      'We are building something fun for Switchyard members: a way to connect you with the people you are most likely to hit it off with.',
    ideaHeading: 'The Idea',
    ideaBody:
      'Give us a quick read on your vibe. Then add as much extra texture as you want. The system uses that information to match you with the people you should meet.',
    outcomeHeading: 'What To Expect',
    outcomeBody:
      'We will mix and mingle a bit to formally meet other Switchyard members you see every day. Then there will be three 10 minute conversations with your top matches. Then whoever wants to stick around can grab drinks and food at Funkatorium. Questions? Email hi@avlgo.com',
    privacyHeading: 'Your Privacy',
    privacyPoints: [
      'Your raw answers are not shown directly to other attendees. Example match shown below.',
      "We use your data only for the Vibe Match flow, we don't share it.",
      'Every question is optional, you control how much context you share.',
    ],
    introClosing: '',
    consentDescription: 'Confirm your name and opt in to AI-powered matching for this event.',
    consentStatement:
      'I understand my profile data will be analyzed by AI and used to match me with other Switchyards Vibe Match attendees. My specific answers are not shared directly.',
    contextTitle: 'Link Drops & Extra Context',
    contextDescription:
      'Totally optional. Share links, background, or artifacts that help us get a better read on you.',
    questionsTitle: 'Your Vibe Survey',
    questionsDescription:
      'Fast signals first, then optional short prompts if you want to add more personality.',
    surveyPhases: [
      {
        key: 'phase1',
        title: 'Phase 1: Quick Signals',
        description:
          'Fast taps to capture your energy, interests, and the kinds of conversations that feel good to you.',
        defaultOpen: true,
        hideHeader: true,
      },
      {
        key: 'phase2',
        title: 'Phase 2: Optional Spark',
        description: 'Short prompts for the details that make you memorable. Entirely optional.',
        defaultOpen: true,
      },
    ],
    oneAnswerHint:
      'You can submit with one answer, but a few more signals makes the matching much sharper.',
    betterAnswerHint:
      'You can submit now, but the more signal you share, the better your Vibe Match results.',
    confirmationBody:
      'Your profile has been submitted. We will use it to generate stronger Switchyards Vibe Match introductions.',
    confirmationSteps: [
      'We analyze your quick-signal answers and any extra context you shared.',
      'We identify the strongest conversation and chemistry matches in the room.',
      'We use that to support better introductions for Switchyards Vibe Match.',
    ],
    confirmationEditNote: 'You can still edit your profile until submissions are locked.',
    backLabel: 'Back to Vibe Match',
    profileTitle: 'Switchyards Vibe Match Profile',
    eventCtaLabel: 'Open Vibe Match',
    flowPageTitlePrefix: 'Switchyards Vibe Match',
    flowPageDescription: 'Switchyards Vibe Match attendee matching setup flow.',
    exampleMatchImage: '/example-match.png',
    landingSource: 'vibe_landing',
    matchesEvent: ({ title, organizer }) => {
      const normalizedTitle = title?.toLowerCase() ?? '';
      const normalizedOrganizer = organizer?.toLowerCase() ?? '';
      return (
        normalizedTitle.includes('switchyards vibe match') ||
        (normalizedTitle.includes('vibe match') && normalizedOrganizer.includes('switchyards')) ||
        (normalizedTitle.includes('switchyards') && normalizedTitle.includes('vibe'))
      );
    },
  },
};

export function isMatchingProgram(value: string): value is MatchingProgram {
  return MATCHING_PROGRAMS.includes(value as MatchingProgram);
}

export function getMatchingProgramConfig(program: MatchingProgram): MatchingProgramConfig {
  return MATCHING_PROGRAM_CONFIGS[program];
}

export function getMatchingProgramsForEvent(event: {
  title?: string | null;
  organizer?: string | null;
}): MatchingProgramConfig[] {
  return MATCHING_PROGRAMS.map((program) => MATCHING_PROGRAM_CONFIGS[program]).filter((config) =>
    config.matchesEvent(event)
  );
}
