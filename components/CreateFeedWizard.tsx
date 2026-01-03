'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TAG_CATEGORIES } from '@/lib/config/tagCategories';
import {
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Music,
  Laugh,
  Film,
  Disc,
  HelpCircle,
  Utensils,
  Beer,
  Wine,
  ChefHat,
  Palette,
  Scissors,
  Dumbbell,
  Trophy,
  Heart,
  Mountain,
  Map,
  Gamepad2,
  GraduationCap,
  BookOpen,
  Users,
  Moon,
  Rainbow,
  PawPrint,
  Building2,
  HandHeart,
  HeartHandshake,
  Gift,
  ShoppingBag,
  ListChecks,
  DollarSign,
  MapPin,
  type LucideIcon,
} from 'lucide-react';

type TagState = 'none' | 'include' | 'exclude';
type PriceFilter = 'any' | 'free' | 'custom';
type LocationFilter = 'asheville' | 'all';

interface WizardState {
  step: 1 | 2 | 3;
  tagStates: Record<string, TagState>;
  priceFilter: PriceFilter;
  maxPrice: number;
  locationFilter: LocationFilter;
}

// Map tags to icons
const TAG_ICONS: Record<string, LucideIcon> = {
  // Entertainment
  'Live Music': Music,
  Comedy: Laugh,
  'Theater & Film': Film,
  Dance: Disc,
  Trivia: HelpCircle,
  // Food & Drink
  Dining: Utensils,
  Beer: Beer,
  'Wine & Spirits': Wine,
  'Food Classes': ChefHat,
  // Activities
  Art: Palette,
  Crafts: Scissors,
  Fitness: Dumbbell,
  Sports: Trophy,
  Wellness: Heart,
  Spiritual: Sparkles,
  Outdoors: Mountain,
  Tours: Map,
  Gaming: Gamepad2,
  Education: GraduationCap,
  'Book Club': BookOpen,
  // Audience/Social
  Family: Users,
  Dating: Heart,
  Networking: Users,
  Nightlife: Moon,
  'LGBTQ+': Rainbow,
  Pets: PawPrint,
  Community: Users,
  Civic: Building2,
  Volunteering: HandHeart,
  'Support Groups': HeartHandshake,
  // Seasonal
  Holiday: Gift,
  Markets: ShoppingBag,
};

export default function CreateFeedWizard() {
  const router = useRouter();
  const [state, setState] = useState<WizardState>({
    step: 1,
    tagStates: {},
    priceFilter: 'any',
    maxPrice: 50,
    locationFilter: 'all',
  });

  const getTagState = (tag: string): TagState => state.tagStates[tag] || 'none';

  const cycleTagState = (tag: string) => {
    const current = getTagState(tag);
    const next: TagState =
      current === 'none' ? 'include' : current === 'include' ? 'exclude' : 'none';
    setState((prev) => ({
      ...prev,
      tagStates: { ...prev.tagStates, [tag]: next },
    }));
  };

  const handleSelectAll = (categoryTags: string[]) => {
    const allIncluded = categoryTags.every((tag) => getTagState(tag) === 'include');
    const newState = allIncluded ? 'none' : 'include';
    setState((prev) => {
      const newTagStates = { ...prev.tagStates };
      categoryTags.forEach((tag) => {
        newTagStates[tag] = newState;
      });
      return { ...prev, tagStates: newTagStates };
    });
  };

  const handleExcludeAll = (categoryTags: string[]) => {
    const allExcluded = categoryTags.every((tag) => getTagState(tag) === 'exclude');
    const newState = allExcluded ? 'none' : 'exclude';
    setState((prev) => {
      const newTagStates = { ...prev.tagStates };
      categoryTags.forEach((tag) => {
        newTagStates[tag] = newState;
      });
      return { ...prev, tagStates: newTagStates };
    });
  };

  const goNext = () => {
    if (state.step < 3) {
      setState((prev) => ({ ...prev, step: (prev.step + 1) as 1 | 2 | 3 }));
    } else {
      // Final step - generate URL and redirect
      const url = buildFeedUrl();
      router.push(url);
    }
  };

  const goBack = () => {
    if (state.step > 1) {
      setState((prev) => ({ ...prev, step: (prev.step - 1) as 1 | 2 | 3 }));
    }
  };

  const buildFeedUrl = (): string => {
    const params = new URLSearchParams();

    // Tags
    const tagsInclude = Object.entries(state.tagStates)
      .filter(([, s]) => s === 'include')
      .map(([tag]) => tag);
    const tagsExclude = Object.entries(state.tagStates)
      .filter(([, s]) => s === 'exclude')
      .map(([tag]) => tag);

    if (tagsInclude.length > 0) {
      params.set('tagsInclude', tagsInclude.join(','));
    }
    if (tagsExclude.length > 0) {
      params.set('tagsExclude', tagsExclude.join(','));
    }

    // Price
    if (state.priceFilter === 'free') {
      params.set('priceFilter', 'free');
    } else if (state.priceFilter === 'custom') {
      params.set('priceFilter', 'custom');
      params.set('maxPrice', state.maxPrice.toString());
    }

    // Location
    if (state.locationFilter === 'asheville') {
      params.set('locations', 'asheville');
    }

    // Trigger save modal
    params.set('showSavePrompt', 'true');

    const queryString = params.toString();
    return queryString ? `/events?${queryString}` : '/events?showSavePrompt=true';
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
      {/* Progress Steps */}
      <div className="px-6 pt-6">
        <div className="flex items-center gap-2">
          <div
            className={`flex-1 py-2 rounded-full text-center text-xs font-medium transition-colors ${
              state.step >= 1
                ? 'bg-brand-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
            }`}
          >
            1. Interests
          </div>
          <div
            className={`flex-1 py-2 rounded-full text-center text-xs font-medium transition-colors ${
              state.step >= 2
                ? 'bg-brand-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
            }`}
          >
            2. Budget
          </div>
          <div
            className={`flex-1 py-2 rounded-full text-center text-xs font-medium transition-colors ${
              state.step >= 3
                ? 'bg-brand-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
            }`}
          >
            3. Location
          </div>
        </div>
      </div>

      {/* Step Content */}
      <div className="p-6">
        {state.step === 1 && (
          <TagsStep
            getTagState={getTagState}
            cycleTagState={cycleTagState}
            handleSelectAll={handleSelectAll}
            handleExcludeAll={handleExcludeAll}
          />
        )}
        {state.step === 2 && (
          <PriceStep
            priceFilter={state.priceFilter}
            maxPrice={state.maxPrice}
            setPriceFilter={(pf) => setState((prev) => ({ ...prev, priceFilter: pf }))}
            setMaxPrice={(mp) => setState((prev) => ({ ...prev, maxPrice: mp }))}
          />
        )}
        {state.step === 3 && (
          <LocationStep
            locationFilter={state.locationFilter}
            setLocationFilter={(lf) => setState((prev) => ({ ...prev, locationFilter: lf }))}
          />
        )}
      </div>

      {/* Navigation */}
      <div className="px-6 pb-6 flex items-center justify-between gap-4">
        <button
          onClick={goBack}
          disabled={state.step === 1}
          className="flex items-center gap-2 px-6 py-3 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          <ChevronLeft className="w-5 h-5" />
          Back
        </button>
        <button
          onClick={goNext}
          className="flex items-center gap-2 px-6 py-3 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium transition-colors cursor-pointer"
        >
          {state.step === 3 ? (
            <>
              <Sparkles className="w-5 h-5" />
              Create My Feed
            </>
          ) : (
            <>
              Next
              <ChevronRight className="w-5 h-5" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// Step 1: Tags Selection
function TagsStep({
  getTagState,
  cycleTagState,
  handleSelectAll,
  handleExcludeAll,
}: {
  getTagState: (tag: string) => TagState;
  cycleTagState: (tag: string) => void;
  handleSelectAll: (tags: string[]) => void;
  handleExcludeAll: (tags: string[]) => void;
}) {
  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
        What kind of events are you interested in?
      </h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
        Click once to include (green), click again to exclude (red)
      </p>

      <div className="space-y-6">
        {TAG_CATEGORIES.map((category) => {
          const allIncluded = category.tags.every((tag) => getTagState(tag) === 'include');
          const allExcluded = category.tags.every((tag) => getTagState(tag) === 'exclude');

          return (
            <div key={category.name}>
              <div className="flex items-center gap-3 mb-3">
                <h3 className="font-semibold text-gray-900 dark:text-white">{category.name}</h3>
                <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
                  <button
                    onClick={() => handleSelectAll(category.tags)}
                    className="hover:text-gray-800 dark:hover:text-gray-200 cursor-pointer"
                  >
                    {allIncluded ? 'Clear' : 'All'}
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={() => handleExcludeAll(category.tags)}
                    className="hover:text-gray-800 dark:hover:text-gray-200 cursor-pointer"
                  >
                    {allExcluded ? 'Clear' : 'None'}
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {category.tags.map((tag) => {
                  const tagState = getTagState(tag);
                  const TagIcon = TAG_ICONS[tag];
                  return (
                    <button
                      key={tag}
                      onClick={() => cycleTagState(tag)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-sm font-medium cursor-pointer transition-all ${
                        tagState === 'none'
                          ? 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500'
                          : tagState === 'include'
                            ? 'border-green-500 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                            : 'border-red-500 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                      }`}
                    >
                      {TagIcon && <TagIcon className="w-4 h-4" />}
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Step 2: Price Preferences
function PriceStep({
  priceFilter,
  maxPrice,
  setPriceFilter,
  setMaxPrice,
}: {
  priceFilter: PriceFilter;
  maxPrice: number;
  setPriceFilter: (pf: PriceFilter) => void;
  setMaxPrice: (mp: number) => void;
}) {
  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
        What&apos;s your budget?
      </h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
        Filter events by price range. Events with unknown prices will still be shown.
      </p>

      <div className="space-y-4">
        <label className="flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all hover:border-brand-300 dark:hover:border-brand-600 border-gray-200 dark:border-gray-700 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 dark:has-[:checked]:bg-brand-900/20">
          <input
            type="radio"
            name="priceFilter"
            checked={priceFilter === 'any'}
            onChange={() => setPriceFilter('any')}
            className="w-5 h-5 text-brand-600 cursor-pointer"
          />
          <ListChecks className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          <div>
            <div className="font-medium text-gray-900 dark:text-white">Show all events</div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Include free and ticketed events of any price
            </div>
          </div>
        </label>

        <label className="flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all hover:border-brand-300 dark:hover:border-brand-600 border-gray-200 dark:border-gray-700 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 dark:has-[:checked]:bg-brand-900/20">
          <input
            type="radio"
            name="priceFilter"
            checked={priceFilter === 'free'}
            onChange={() => setPriceFilter('free')}
            className="w-5 h-5 text-brand-600 cursor-pointer"
          />
          <Gift className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          <div>
            <div className="font-medium text-gray-900 dark:text-white">Free events only</div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Only show events that are free to attend
            </div>
          </div>
        </label>

        <label className="flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all hover:border-brand-300 dark:hover:border-brand-600 border-gray-200 dark:border-gray-700 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 dark:has-[:checked]:bg-brand-900/20">
          <input
            type="radio"
            name="priceFilter"
            checked={priceFilter === 'custom'}
            onChange={() => setPriceFilter('custom')}
            className="w-5 h-5 text-brand-600 mt-1 cursor-pointer"
          />
          <DollarSign className="w-5 h-5 text-gray-500 dark:text-gray-400 mt-0.5" />
          <div className="flex-1">
            <div className="font-medium text-gray-900 dark:text-white">Set a maximum price</div>
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              Hide events that are confirmed to be above your budget
            </div>
            {priceFilter === 'custom' && (
              <div className="space-y-2">
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="5"
                    max="200"
                    step="5"
                    value={maxPrice}
                    onChange={(e) => setMaxPrice(parseInt(e.target.value))}
                    className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-brand-600"
                  />
                  <span className="text-lg font-semibold text-brand-600 dark:text-brand-400 min-w-[60px] text-right">
                    ${maxPrice}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-500">
                  <span>$5</span>
                  <span>$200</span>
                </div>
              </div>
            )}
          </div>
        </label>
      </div>
    </div>
  );
}

// Step 3: Location Preferences
function LocationStep({
  locationFilter,
  setLocationFilter,
}: {
  locationFilter: LocationFilter;
  setLocationFilter: (lf: LocationFilter) => void;
}) {
  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
        Where do you want to find events?
      </h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">Choose your preferred area</p>

      <div className="space-y-4">
        <label className="flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all hover:border-brand-300 dark:hover:border-brand-600 border-gray-200 dark:border-gray-700 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 dark:has-[:checked]:bg-brand-900/20">
          <input
            type="radio"
            name="locationFilter"
            checked={locationFilter === 'asheville'}
            onChange={() => setLocationFilter('asheville')}
            className="w-5 h-5 text-brand-600 cursor-pointer"
          />
          <MapPin className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          <div>
            <div className="font-medium text-gray-900 dark:text-white">Asheville only</div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Events in Asheville city limits
            </div>
          </div>
        </label>

        <label className="flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all hover:border-brand-300 dark:hover:border-brand-600 border-gray-200 dark:border-gray-700 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 dark:has-[:checked]:bg-brand-900/20">
          <input
            type="radio"
            name="locationFilter"
            checked={locationFilter === 'all'}
            onChange={() => setLocationFilter('all')}
            className="w-5 h-5 text-brand-600 cursor-pointer"
          />
          <Map className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          <div>
            <div className="font-medium text-gray-900 dark:text-white">
              Asheville & surrounding area
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Include events in Black Mountain, Weaverville, Hendersonville, and more
            </div>
          </div>
        </label>
      </div>
    </div>
  );
}
