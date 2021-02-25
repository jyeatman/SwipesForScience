import _ from "lodash";

/**
 * NOTES:
 *
 * All rule functions take the same parameters (details in `completelyRandomRule`).
 * All rule functions must return a stimulus id.
 *
 * Helpful stuff:
 *   - a
 */

/**
 * Picks any stimulus at random.
 *
 * Note: all available parameters shown for reference.
 */
export const completelyRandomRule = ({
  /* eslint-disable no-unused-vars */
  // data on user, including `admin`, `level`, `score`, and `taken_tutorial`
  userData,
  // data specific to the most recently swiped stimulus
  lastStimulus: {
    // stimulus id
    widgetPointer,
    // tracks `aveVote` and `count`, just within the current game
    widgetSummary,
    // swipe value (set in `config.widgetProperties`)
    response,
    // time elapsed between image load and user swipe
    timeDiff,
    // the stimParams object (if any)
    params
  },
  // data specific to the current game (starting from user clicking "Play Now" button)
  currentGame: {
    // list of stimulus ids since start of current game
    seenSinceStart,
    // list of stimulus ids since start of current ruled series (set by `config.rulesSequence`)
    seenInSeries
  },
  // data from all recorded games
  allGames: {
    // tracks `.val` (number of views by every user) for each `.key` (stimulus id)
    samplesAndCounts,
    // tracks `.val` (number of views by this user) for each `.key` (stimulus id)
    userSeenSamples
  },
  // a dict of stimParams (keys are `imagenames`)
  stimParams
  /* eslint-enable no-unused-vars */
}) => {
  const randIndex = Math.floor(Math.random() * samplesAndCounts.length);
  const nextSample = samplesAndCounts[randIndex];
  return nextSample[".key"];
};

/**
 * A couple of rules demonstrating specifically ordered series.
 */
const first = "sub-NDARHF904CWB__ax_70";
const second = "sub-NDAREW671HZW__ax_65";
const third = "sub-NDAREG590BNY__cor_197";
const fourth = "sub-NDARMM878ZR1__cor_106";
const currentToNext = {
  [first]: second,
  [second]: third,
  [third]: fourth
};
export const specificOrderRule = params =>
  currentToNext[params.lastStimulus.widgetPointer] || first;

export const specificOrderAndStartRule = params =>
  params.currentGame.seenSinceStart.length
    ? currentToNext[params.lastStimulus.widgetPointer]
    : first;

/**
 * This is the default setting used in the original SwipesForScience.
 */
export const prioritizeByViewsRule = params => {
  const samplePriority = _.sortBy(params.allGames.samplesAndCounts, ".value");

  // remove all the samples that the user has seen
  let samplesRemain, prioritizedSamples;
  if (params.allGames.userSeenSamples) {
    // if the user has seen some samples, remove them
    const userSeenList = _.map(params.allGames.userSeenSamples, s => s[".key"]);
    samplesRemain = _.filter(
      samplePriority,
      v => userSeenList.indexOf(v[".key"]) < 0
    );

    // but if the user has seen everything,
    // return the total sample priority
    samplesRemain = samplesRemain.length ? samplesRemain : samplePriority;
  } else {
    // the user hasn't seen anything yet, so all samples remain
    samplesRemain = samplePriority;
  }

  if (samplesRemain.length) {
    // some samples remain to be seen.
    // get the smallest value that hasn't been seen by user yet.
    // samplesRemain is sorted, so the first value has been seen the
    // least number of times.
    const minUnseen = samplesRemain[0][".value"];
    // then filter the rest of the samples
    // so they are only the smallest seen value;
    const samplesSmallest = _.filter(
      samplesRemain,
      c => c[".value"] === minUnseen
    );
    // and then randomize the order;
    prioritizedSamples = shuffle(samplesSmallest);
  }

  // TODO: check whether we actually hit this line. If we don't, remove it.
  prioritizedSamples = shuffle(samplePriority);

  // pick top sample and return its id
  return prioritizedSamples[0][".key"];
};

const shuffle = array => {
  // a method to shuffle an array, from
  // https://stackoverflow.com/questions/2450954/how-to-randomize-shuffle-a-javascript-array
  let currentIndex = array.length;
  let temporaryValue;
  let randomIndex;
  // While there remain elements to shuffle...
  while (currentIndex !== 0) {
    // Pick a remaining element...
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex -= 1;
    // And swap it with the current element.
    temporaryValue = array[currentIndex];
    /* eslint-disable */
      array[currentIndex] = array[randomIndex]
      array[randomIndex] = temporaryValue
      /* eslint-enable */
  }
  return array;
};
