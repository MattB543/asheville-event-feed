import {
  isNumber,
  isRecord,
  isString,
  isUnknownArray,
  type JsonRecord,
} from '@/lib/utils/validation';

export const MATCHING_INPUT_TYPES = [
  'long_text',
  'short_text',
  'url',
  'multi_url',
  'multi_text',
  'file_markdown',
  'multi_image',
  'single_select',
  'multi_select',
  'ranking',
  'slider',
] as const;

export type MatchingInputType = (typeof MATCHING_INPUT_TYPES)[number];

export type MatchingSurveyPhaseKey = 'phase1' | 'phase2';

export interface MatchingQuestionOption {
  value: string;
  label: string;
  description?: string;
}

export interface MatchingQuestionConfig {
  phase?: MatchingSurveyPhaseKey;
  placeholder?: string;
  options?: MatchingQuestionOption[];
  minSelections?: number;
  maxSelections?: number;
  gridColumns?: number;
  sliderMin?: number;
  sliderMax?: number;
  sliderStep?: number;
  minLabel?: string;
  maxLabel?: string;
  maxImages?: number;
  aiPrompt?: string;
}

function parseOptions(value: unknown): MatchingQuestionOption[] | undefined {
  if (!isUnknownArray(value)) return undefined;

  const options = value.flatMap((item) => {
    if (!isRecord(item) || !isString(item.value) || !isString(item.label)) {
      return [];
    }

    return [
      {
        value: item.value,
        label: item.label,
        description: isString(item.description) ? item.description : undefined,
      },
    ];
  });

  return options.length > 0 ? options : undefined;
}

function readString(record: JsonRecord, key: string): string | undefined {
  return isString(record[key]) ? record[key] : undefined;
}

function readNumber(record: JsonRecord, key: string): number | undefined {
  return isNumber(record[key]) ? record[key] : undefined;
}

export function parseMatchingQuestionConfig(value: unknown): MatchingQuestionConfig {
  if (!isRecord(value)) return {};

  const phase = readString(value, 'phase');
  const parsedPhase = phase === 'phase1' || phase === 'phase2' ? phase : undefined;

  return {
    phase: parsedPhase,
    placeholder: readString(value, 'placeholder'),
    options: parseOptions(value.options),
    minSelections: readNumber(value, 'minSelections'),
    maxSelections: readNumber(value, 'maxSelections'),
    gridColumns: readNumber(value, 'gridColumns'),
    sliderMin: readNumber(value, 'sliderMin'),
    sliderMax: readNumber(value, 'sliderMax'),
    sliderStep: readNumber(value, 'sliderStep'),
    minLabel: readString(value, 'minLabel'),
    maxLabel: readString(value, 'maxLabel'),
    maxImages: readNumber(value, 'maxImages'),
    aiPrompt: readString(value, 'aiPrompt'),
  };
}

export function getQuestionOptionLabel(
  config: MatchingQuestionConfig | undefined,
  value: string
): string {
  const option = config?.options?.find((entry) => entry.value === value);
  return option?.label ?? value;
}
