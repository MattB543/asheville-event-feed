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
      "Meet up with Switchyards members on Sat April 11th at 4:30 PM - we'll analyze all surveys and match you with the people you are most likely to enjoy chatting with.",
      'The survey is short, all questions are optional, but the more you provide the better. Use desktop over mobile if possible as we ask you to drop links or share your resume.',
      'Your raw answers stay private. They are used only to build stronger introductions and matches for this event.',
    ],
    onboardingTitle: 'Switchyards Vibe Match',
    onboardingDescription: 'Switchyards Vibe Match attendee matching setup flow.',
    introHeading: '',
    introLead:
      'We are building something playful for Switchyards: a way to connect you with the people you are most likely to hit it off with.',
    ideaHeading: 'The Idea',
    ideaBody:
      'Give us a quick read on your energy, interests, and conversational style. Then add as much extra texture as you want. The system uses that signal to spot the people you should meet.',
    outcomeHeading: 'What You Get',
    outcomeBody:
      'You get stronger intros, better conversation starters, and a more intentional room once Vibe Match starts.',
    privacyHeading: 'Your Privacy',
    privacyPoints: [
      'Your raw answers are not shown directly to other attendees.',
      'We use your data only for the Switchyards Vibe Match flow.',
      'Most of the survey is optional, and you control how much context you share.',
    ],
    introClosing:
      'Fast taps are enough to participate. A little extra context simply helps the matching work better.',
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
