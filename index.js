const tracker = require("pivotaltracker");
const moment = require("moment");
const fs = require("fs");
// const util = require("util");

const dateFormat = "Do MMMM YYYY";
const dateSort = (a,b) => moment(a).isAfter(b) ? 1 : -1;

const client = new tracker.Client(process.env.PIVOTAL_TRACKER_TOKEN);

const projectId = process.argv[2];

if(!projectId) {
  console.error(`Usage ${process.argv[1]} projectId`);
  process.exit(-1);
}

const extra = process.argv[3] ? fs.readFileSync(process.argv[3]) : "";

async function run() {
  console.error("Getting project info");
  const project = await getProjectInfo(projectId);
  console.error("Getting project stories");
  const stories = await getProjectStories(projectId);
  console.error("Getting project epics");
  const epics = await getProjectEpics(projectId);
  console.error("Getting iterations")
  const iterations = await getProjectIterations(projectId);

  console.error(`#stories=${stories.length} #epics=${epics.length} #iterations=${iterations.length}`);

  console.error("Processing stories");
  const storiesForLabel = {};
  stories.forEach(s => {
    const labels = Array.isArray(s.labels) ? s.labels : [];
    labels.forEach(l => {
      if(!Array.isArray(storiesForLabel[l.name])) {
        storiesForLabel[l.name] = [];
      }
      storiesForLabel[l.name].push(s);
    })
  });

  const iterationNumberForStoryId = {};
  const iterationForNumber = {};
  iterations.forEach(iteration => {
    iterationForNumber[iteration.number] = iteration;
    const iterationStories = Array.isArray(iteration.stories) ? iteration.stories : [];
    iterationStories.forEach(story => {
      iterationNumberForStoryId[story.id] = iteration.number;
    })
  });

  // console.log(storiesForLabel['epic-technical-debt'].map(s => s.createdAt).sort((a,b) => moment(a).isAfter(b) ? 1 : -1));

  console.log("@startgantt");
  const projectCreatedAt = moment(project.createdAt); // moment(stories.map(s => s.createdAt).sort((a,b) => moment(a).isAfter(b) ? 1 : -1)[0]);
  console.log(`Project starts the ${projectCreatedAt.format(dateFormat)}`);
  const items = await Promise.all(epics.map(async epic => {
    if(epic.description && epic.description.indexOf("*SKIP_GANTT*") > -1) {
      // console.error(`Skipping epic: ${epic.name}`);
      return;
    }

    if(epic.createdAt && (epic.projectedCompletion || epic.completedAt)) {
      // const epicCreatedAt = moment(epic.createdAt);
      const epicStories = storiesForLabel[epic.label.name].filter(s => s.currentState !== "unscheduled") || [];
      const totStories = epicStories.length;
      if(totStories == 0) {
        return;
      }

      const storiesStartDate = (await Promise.all(epicStories.map(s => getStoryStartedAt(projectId, s.id)))).filter(d => d);
      const firstStoryStartedAt = storiesStartDate.length > 0 ? storiesStartDate.sort(dateSort)[0] : undefined;

      const storiesPlannedIteration = epicStories.map(s => iterationNumberForStoryId[s.id]).filter(i => i >= 0).sort((a,b) => a - b);
      const firstStoryPlannedAt = storiesPlannedIteration.length > 0 ? iterationForNumber[storiesPlannedIteration[0]].start : undefined;

      const totAcceptedStories = epicStories.filter(e => e.currentState === "accepted").length;
      const completedPercent = totStories > 0 ? Math.ceil(100.0 * totAcceptedStories / totStories) : 0;

      const storiesCreatedTimes = epicStories.map(s => s.createdAt).sort(dateSort);

      const firstStoryTimestamp = firstStoryStartedAt || firstStoryPlannedAt; // || storiesCreatedTimes[0];

      // console.error(firstStoryTimestamp);
      const epicStartsAt = projectCreatedAt.isAfter(firstStoryTimestamp) ? projectCreatedAt : moment(firstStoryTimestamp);

      const { color, description } = getCompletionPercentDescriptionAndColor(completedPercent);
      const epicName = `${epic.name} ${description}`;

      if(totAcceptedStories == totStories) {
        const storiesAcceptedTimes = epicStories.map(s => s.acceptedAt).sort(dateSort);
        const lastStoryUpdatedAt = storiesAcceptedTimes[storiesAcceptedTimes.length - 1]
        const epicCompletedAt = moment(lastStoryUpdatedAt);
        const epicDuration = moment.duration(epicCompletedAt.diff(epicStartsAt));
        const epicDurationInDays = Math.ceil(epicDuration.asDays());
        return({
          text: `[${epicName}] as [${epic.id}] starts the ${epicStartsAt.format(dateFormat)} and lasts ${epicDurationInDays} days and is colored in ${color}`,
          startsAt: moment(epicStartsAt).valueOf()
        });
      } else {
        const epicProjectedCompletion = moment(epic.projectedCompletion);
        const epicDuration = moment.duration(epicProjectedCompletion.diff(epicStartsAt));
        // console.log(`${epicStartsAt} to ${epicProjectedCompletion} (${epic.projectedCompletion})`);
        const epicDurationInDays = Math.ceil(epicDuration.asDays());
        // console.log(`${epicDuration} -> ${epicDurationInDays}`);
        return({
          text: `[${epicName}] as [${epic.id}] starts the ${epicStartsAt.format(dateFormat)} and lasts ${epicDurationInDays} days and is colored in ${color}`,
          startsAt: epicStartsAt.valueOf()
        });
      }
    }
  }));
  console.log(items.filter(i => i).sort((a,b) => a.startsAt - b.startsAt).map(i => i.text).join("\n"));
  console.log(`${extra}`);
  console.log("@endgantt");
}

async function getProjectInfo(projectId) {
  return new Promise((res, rej) => {
    client.project(projectId).get((err, p) => {
      if(err) {
        return rej(err);
      }
      res(p);
    });
  });
}

async function getProjectEpics(projectId) {
  return new Promise((res, rej) => {
    client.project(projectId).epics.all((err, epics) => {
      if(err) {
        return rej(err);
      }
      const epicIds = epics.map(e => e.id);
      const epicPromises = epicIds.map(epicId => getEpic(projectId, epicId));
      Promise.all(epicPromises).then(res).catch(rej);
    });
  });
}

async function getEpic(projectId, epicId) {
  return new Promise((res, rej) => {
    client.project(projectId).epic(epicId).get((err, epic) => {
      if(err) {
        return rej(err);
      }
      res({...epic});
    });
  });
}

/*
async function getProjectStories(projectId) {
  return new Promise((res, rej) => {
    client.project(projectId).stories.all({limit: 999}, (err, stories) => {
      if(err) {
        return rej(err);
      }
      res(stories);
    });
  });
}
*/

async function getProjectStories(projectId) {
  const limit = 100;
  var offset = 0;
  const stories = [];
  while(true) {
    const someStories = await getProjectStoriesPage(projectId, limit, offset);
    if(someStories.length == 0) {
      return stories;
    } else {
      stories.push(...someStories);
      offset += limit;
    }
  }
}

async function getProjectStoriesPage(projectId, limit, offset) {
  return new Promise((res, rej) => {
    client.project(projectId).stories.all({limit, offset}, (err, stories) => {
      if(err) {
        return rej(err);
      }
      res(stories);
    });
  });
}

async function getStoryStartedAt(projectId, storyId) {
  const activity = await getStoryActivity(projectId, storyId);
  if(!activity) {
    return undefined;
  }
  var occurredAt = undefined;
  activity.forEach(a => {
    if(a.highlight == "started") {
      occurredAt = a.occurredAt;
    }
  });
  return occurredAt;
}

async function getStoryActivity(projectId, storyId) {
  return new Promise ((res, rej) => {
    client.project(projectId).story(storyId).activity.all((err, activity) => {
      if(err) {
        return rej(err);
      }
      res(activity);
    });
  });
}

async function getProjectIterations(projectId) {
  return new Promise((res, rej) => {
    client.project(projectId).iterations.all((err, iterations) => {
      if(err) {
        return rej(err);
      }
      res(iterations);
    });
  });
}

function getCompletionPercentDescriptionAndColor(p) {
  if (p == 0) {
    return {
      color: "White/Black",
      description: ""
    };
  } else if(p == 100) {
    return {
      color: "LightGreen/Black",
      description: "(Completata)"
    };
  } else {
    return {
      color: "LightGray/Black",
      description: `(In corso: ${p}%)`
    };
  }
}

run();