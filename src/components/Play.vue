<template name="play">
  <div id="play" class="container">
    <!-- Modal Component -->
    <b-modal id="levelUp" ref="levelUp" title="You've Levelled Up!" ok-only>
      <div class="my-4">
        <h3>Level {{ currentLevel.level }}</h3>
        <img :src="currentLevel.img" width="120px" height="120px" />
        <p class="lead">You've unlocked: {{ currentLevel.character }}</p>
      </div>
    </b-modal>

    <div class="main">
      <b-alert
        :show="dismissCountDown"
        :variant="feedback.variant"
        class="toast"
        @dismissed="dismissCountdown = 0"
        @dismiss-count-down="countDownChanged"
      >
        {{ feedback.message }}
      </b-alert>

      <div v-if="noData">
        <h1>There is no data in your database!</h1>
        <p class="lead">
          Follow the instructions to set up your SwipesForScience App
        </p>
        <img class="blankImage" :src="blankImage" alt="there is no data" />
      </div>

      <div v-else>
        <div v-if="!widgetPointer">
          <Flask />
          <p class="mt-3 pt-3 lead">loading...</p>
        </div>

        <WidgetSelector
          v-else
          :widgetType="widgetType"
          :widgetPointer="widgetPointer"
          :widgetProperties="widgetProperties"
          :widgetSummary="widgetSummary"
          :votingImage="votingImage"
          :interStimuliImage="interStimuliImage"
          :userSettings="userSettings"
          :needsSecret="needsSecret"
          :serverSecret="serverSecret"
          v-on:widgetRating="sendWidgetResponse"
          v-on:setStartTime="setStartTime"
          v-on:updateUserSettings="updateUserSettings"
          :playMode="'play'"
          ref="widget"
        />
      </div>
    </div>
  </div>
</template>

<style>
/*https://github.com/pudymody/tinderSwipe/blob/gh-pages/style.css*/

.main {
  min-height: 100vh;
}

.toast {
  width: auto;
  max-width: 200px;
  top: 60px;
  left: 0;
  margin: auto;
  position: absolute;
  right: 0;
  z-index: 999;
}

.blankImage {
  max-width: 500px;
}
</style>

<script>
/**
   * This is the component for the `/play` route. It's view depends on the
   * config property passed from the parent (`App.vue`). It displays the widget
   * based on config.widgetType. It also decides which sample will be presented
   * (`widgetPointer`) and passes the sample's summary (`widgetSummary`) to its
   * widget component (`WidgetSelector`).
   *
   * This component is responsible for the following:
   * 1. Deciding which sample to present by choosing an item in `/sampleCounts`
   * that has been seen the least number of times, but also making sure the user
   * hasn't seen that sample yet (by reading from `/userSeenSamples/<username>`).
   * 2. sending the user's response from the widget. This includes:
   *   1. getting feedback from the widget and displaying it.
   *   2. saving the response and the time it took to make the response
   *      (pushes to `/votes` in firebase)
       3. Updating the user's score
       4. Updating that sample's count
       5. Updating that the user has seen the sample
       6. Updating that sample's summary
       7. And then loading the next sample to view.
   */
import _ from "lodash";
import Vue from "vue";
import WidgetSelector from "./WidgetSelector";
import Flask from "./Animations/Flask";
import axios from "axios";
import csv from "papaparse";

Vue.component("WidgetSelector", WidgetSelector);

export default {
  name: "play",
  props: {
    /**
     * the authenticated user object from firebase
     */
    userInfo: {
      type: Object,
      required: true
    },
    /**
     * the computed user data object based on userInfo
     */
    userData: {
      type: Object,
      required: true
    },
    /**
     * the various levels, the points need to reach the levels,
     * and the badges (colored and greyed out) to display
     */
    levels: {
      type: Object,
      required: true
    },
    /**
     * the user's current level
     */
    currentLevel: {
      type: Object,
      required: true
    },
    /**
     * The config object that is loaded from src/config.js.
     * It defines how the app is configured, including
     * any content that needs to be displayed (app title, images, etc)
     * and also the type of widget and where to update pointers to data
     */
    config: {
      type: Object,
      required: true
    },
    /**
     * the intialized firebase database
     */
    db: {
      type: Object,
      required: true
    }
  },
  data() {
    return {
      /**
       * keep track of the time a user took to vote on a sample
       */
      startTime: null,
      /**
       * flags for the small toast that shows feedback
       */
      dismissSecs: 1,
      /**
       * flags for the small toast that shows feedback
       */
      dismissCountDown: 0,

      /**
       * feedback will be filled by the widget component
       * for now its initialized here
       */
      feedback: {
        variant: "warning",
        message: ""
      },

      /**
       * status flag that is set to "complete" when the firebase keys are filled.
       */
      status: "loading",

      /**
       * these keys will be filled by firebase when the component is mounted
       */
      sampleCounts: [],
      userSeenSamples: [],

      /**
       * if sampleCounts is empty after its fetched from the db, then noData
       * flag is set to true. TODO: prompt the user to the setup instructions
       */
      noData: false,

      /**
       * widgetPointer is a pointer to the keys in sampleCounts, sampleSummary, and sampleChats
       */
      widgetPointer: null,

      /**
       * widget summary comes from firebase when the widget Pointer is set.
       */
      widgetSummary: {},

      /**
       * user settings comes from firebase. it can be set by the widget to save state for the user.
       */
      userSettings: {},
      /**
       * secret key (btoa'd) from the firebase server, in case the widget is locked.
       */
      serverSecret: "",
      /**
       * If rulesSequence is configured, keeps track of current rule
       */
      currentRuleIndex: 0,
      /**
       * If rulesSequence is configured, keeps track of all stimuli id seen in current series
       */
      seenInSeries: [],
      /**
       * If rulesSequence is configured, keeps track of all stimuli id seen since play began
       */
      seenSinceStart: [],
      stimParams: {}
    };
  },
  watch: {
    /**
     * Keep track of the user's current level.
     * Update the database if their score pushes them up a level.
     * This depends on the `level` prop that is passed from the parent (`App.vue`)
     */
    currentLevel() {
      if (
        this.userData.score === this.currentLevel.min &&
        this.currentLevel.min
      ) {
        this.$refs.levelUp.show();
        this.db
          .ref(`/users/${this.userInfo.displayName}`)
          .child("level")
          .set(this.currentLevel.level);
      }
    },
    /**
     * Watch the widget pointer, which is from `/sampleCounts` document in firebase.
     * When it changes, also update the `widgetSummary` to be from the new `widgetPointer`.
     */
    widgetPointer() {
      /* eslint-disable */
        this.widgetPointer ? this.db.ref('sampleSummary').child(this.widgetPointer).once('value', (snap) => {
          this.widgetSummary = snap.val();
        }) : null;
        /* eslint-enable */
    }
  },
  /**
   * When the component mounts, initialize the sampleCounts from firebase,
   * and also the samples the user has seen.
   */
  mounted() {
    this.initSampleCounts();
    this.initSeenSamples();
    this.initUserSettings();
    this.fetchServerSecret();
    this.initStimParams();
  },
  components: {
    // WidgetSelector,
    Flask
  },
  computed: {
    /**
     * sort the sampleCounts from firebase by their value, where the lowest count is first.
     */
    samplePriority() {
      return _.sortBy(this.sampleCounts, ".value");
    },
    /**
     * if there is nothing in the database, display a blank image
     */
    blankImage() {
      return this.config.play.blankImage;
    },
    /**
     * for TimedImageSwipe widget
     */
    votingImage() {
      return this.config.play.votingImage;
    },
    /**
     * for TimedImageSwipe widget
     */
    interStimuliImage() {
      return this.config.play.interStimuliImage;
    },
    /**
     * type of widget, named exactly how it is in the Widgets folder
     */
    widgetType() {
      return this.config.widgetType;
    },
    /**
     * specific properties for a widget
     */
    widgetProperties() {
      return this.config.widgetProperties;
    },
    /**
     * Provides the ability to configure the game as a set of series,
     * where each series has a configurable number of stimuli and decides
     * the next stimuli by a given rule.
     */
    rulesSequence() {
      return this.config.rulesSequence;
    },
    /**
     * If rulesSequence is configured, returns the current rule (filter) function
     */
    currentRule() {
      return this.rulesSequence[this.currentRuleIndex].rule;
    },
    /**
     * whether or not the widget requires a secret (for locking down data)
     */
    needsSecret() {
      return this.config.widgetUsesSecret;
    }
  },
  methods: {
    /**
     * the /userSettings/<username> from firebase is always in sync.
     * this property saves the state of the widget, if it needs it.
     */
    initUserSettings() {
      this.db
        .ref("userSettings")
        .child(this.userInfo.displayName)
        .on("value", snap => {
          const val = snap.val();
          if (val == null) {
            this.userSettings = {};
          } else {
            this.userSettings = val;
          }
        });
    },
    /**
     * update the /userSettings/<username> in firebase.
     * this method is called when the widget emits the "udpateUserSettings" event.
     */
    updateUserSettings(settings) {
      if (settings) {
        this.db
          .ref("userSettings")
          .child(this.userInfo.displayName)
          .set(settings);
      }
    },
    /**
     * Ask Firebase for the sampleCounts document,
     * but don't watch it in real time, just fetch the data once.
     */
    initSampleCounts() {
      this.db.ref("sampleCounts").once("value", snap => {
        /* eslint-disable */
          this.sampleCounts = _.map(snap.val(), (val, key) => {
            return { '.key': key, '.value': val };
          });
          /* eslint-enable */
        if (!this.sampleCounts.length) {
          this.noData = true;
        } else {
          this.startTime = new Date();
          this.rulesSequence
            ? this.setNextSampleIdByRule()
            : this.setNextSampleId();
        }
      });
    },
    /**
     * Initialize the samples that the user has seen, by fetching the
     * `/userSeenSamples/<username>` document from firebase, once.
     */
    initSeenSamples() {
      this.db
        .ref("userSeenSamples")
        .child(this.userInfo.displayName)
        .once("value", snap => {
          /* eslint-disable */
            this.userSeenSamples = _.map(snap.val(), (val, key) => {
              return { '.key': key, '.value': val };
            });
            /* eslint-enable */
        });
    },
    initStimParams() {
      axios.get(this.config.stimParamsUrl).then(({ data }) => {
        // resp.data has a list of firebase-friendly strings
        const stimParamsList = csv.parse(data, {
          header: true,
          dynamicTyping: true
        }).data;
        stimParamsList.forEach(params => {
          this.stimParams[params.imagename] = params;
          delete params.imagename;
        });
      });
    },
    /**
     * A method to shuffle an array.
     */
    shuffle(array) {
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
          array[currentIndex] = array[randomIndex];
          array[randomIndex] = temporaryValue;
          /* eslint-enable */
      }
      return array;
    },
    /**
     * A method that returns an array of samples prioritized by
     * the least seen overall and by the user
     */
    sampleUserPriority() {
      // if the user is logged in then,
      if (this.userInfo) {
        // remove all the samples that the user has seen
        let samplesRemain;
        if (this.userSeenSamples) {
          // if the user has seen some samples, remove them
          const userSeenList = _.map(this.userSeenSamples, s => s[".key"]);
          samplesRemain = _.filter(
            this.samplePriority,
            v => userSeenList.indexOf(v[".key"]) < 0
          );

          // but if the user has seen everything,
          // return the total sample priority
          samplesRemain = samplesRemain.length
            ? samplesRemain
            : this.samplePriority;
        } else {
          // the user hasn't seen anything yet, so all samples remain
          samplesRemain = this.samplePriority;
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
          return this.shuffle(samplesSmallest);
        }

        // TODO: check whether we actually hit this line. If we don't, remove it.
        return this.shuffle(this.samplePriority);
      }
      // if samplePriority was empty the whole time, return null
      return null;
    },
    /**
     * called from child widget
     * used to set start time according to child widget needs
     */
    setStartTime(response) {
      this.startTime = response;
    },
    /**
     * this method is called from the child widget
     * it will first get feedback from the child on the response
     * next, it will send the user response to the db
     * then it will update the user's score and the sample's view count
     * last, it will set the next sample.
     */
    sendWidgetResponse(response) {
      // record timeDiff as soon as possible
      const timeDiff = new Date() - this.startTime;

      // 1. get feedback from the widget, and display if needed
      const feedback = this.$refs.widget.getFeedback(response);
      if (feedback.show) {
        this.feedback = feedback;
        this.showAlert();
      }

      // 2. send the widget data
      this.sendVote(response, timeDiff);

      // 3. update the score and count for the sample
      this.updateScore(this.$refs.widget.getScore(response));
      this.updateSummary(this.$refs.widget.getSummary(response));
      this.updateCount();
      this.updateSeen();

      // 4. set the next Sample
      this.rulesSequence
        ? this.setNextSampleIdByRule(response, timeDiff)
        : this.setNextSampleId();
    },
    /**
     * method to get the next sample id to show in the widget
     */
    setNextSampleId() {
      const sample = this.sampleUserPriority()[0];

      // if sampleId isn't null, set the widgetPointer
      if (sample) {
        this.widgetPointer = sample[".key"];
      }
    },
    /**
     * method to get the next sample id to show in the widget
     * by filtering by configured rule
     */
    setNextSampleIdByRule(response, timeDiff) {
      const params = {
        userData: this.userData,
        lastStimulus: {
          widgetPointer: this.widgetPointer,
          widgetSummary: this.widgetSummary,
          response,
          timeDiff,
          params: this.stimParams[this.widgetPointer]
        },
        currentGame: {
          seenSinceStart: this.seenSinceStart,
          seenInSeries: this.seenInSeries
        },
        allGames: {
          samplesAndCounts: this.sampleCounts,
          userSeenSamples: this.userSeenSamples
        },
        stimParams: this.stimParams
      };

      const sampleId = this.currentRule(params);
      // if sampleId isn't null, set the widgetPointer
      if (sampleId) {
        this.widgetPointer = sampleId;
      }

      this.trackRuleProgress(this.widgetPointer);
    },
    /**
     *
     */
    trackRuleProgress(sampleId) {
      this.seenInSeries.push(sampleId);
      this.seenSinceStart.push(sampleId);

      // move to the next rule and clear series tracker
      // if enough trials have been seen
      const { numTrials } = this.rulesSequence[this.currentRuleIndex];
      if (this.seenInSeries.length >= numTrials) {
        this.currentRuleIndex++;
        // move back to the first rule if last rule is passed
        if (this.currentRuleIndex >= this.rulesSequence.length) {
          this.currentRuleIndex = 0;
        }
        this.seenInSeries = [];
      }
    },
    /**
     * the user's response for the sample is sent to the db
     * along with their user displayName and the time they took to respond.
     */
    sendVote(response, time) {
      this.db.ref("votes").push({
        user: this.userInfo.displayName,
        sample: this.widgetPointer,
        response,
        time
      });
    },
    /**
     * this method update's the user's score by scoreIncrement;
     */
    updateScore(scoreIncrement) {
      this.db
        .ref("users")
        .child(this.userInfo.displayName)
        .child("score")
        .transaction(score => (score || 0) + scoreIncrement);
    },
    /**
     * Update the summary of a given widgetPointer
     */
    updateSummary(summary) {
      this.db
        .ref("sampleSummary")
        .child(this.widgetPointer)
        .set(summary);
    },
    /**
     * Update the sampleCount of the current widgetPointer.
     */
    updateCount() {
      // update the firebase database copy
      this.db
        .ref("sampleCounts")
        .child(this.widgetPointer)
        .transaction(count => (count || 0) + 1);

      // update the local copy
      _.map(this.sampleCounts, val => {
        if (val[".key"] === this.widgetPointer) {
          /* eslint-disable */
            val['.value'] += 1;
            /* eslint-enable */
        }
      });
    },
    /**
     * Update that the user has seen this sample, incrementing by 1.
     */
    updateSeen() {
      // mark that this user has seen this widgetPointer
      // update the firebase database copy
      this.db
        .ref("userSeenSamples")
        .child(this.userInfo.displayName)
        .child(this.widgetPointer)
        .transaction(count => (count || 0) + 1);

      // update the local copy
      this.userSeenSamples.push({ ".key": this.widgetPointer, ".value": 1 });
    },
    /**
     * This is for the toast component that shows feedback, to keep track of time.
     */
    countDownChanged(dismissCountDown) {
      this.dismissCountDown = dismissCountDown;
    },
    /**
     * This is to show the toast alert component, for widget feedback.
     */
    showAlert() {
      this.dismissCountDown = this.dismissSecs;
    },
    /**
     * fetch the server secret and set it in this.data
     */
    fetchServerSecret() {
      this.db
        .ref("settings")
        .child("secret")
        .once("value")
        .then(snap => {
          this.serverSecret = snap.val();
        });
    }
  }
};
</script>

https://github.com/yeatmanlab/SwipesForScience
