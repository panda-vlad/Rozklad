const Telegraf = require('telegraf');
const jsdom = require('jsdom');
const request = require('request');
const querystring = require('querystring');
const url = require('url');
const http = require('http');

const hostname = 'rozklad.kpi.ua';
const bot = new Telegraf(process.env.TGBOT_TOKEN);


// Storage of group names per chat
const groups = {"389124173": "ІП-72"};

// on first interaction
bot.start(({ reply }) =>
  reply('Hi! I can parse rozklad.kpi.ua.\nSay /setgroup ІП-72 to set your group, \nuse /today, /now and /all to get your timetable')
);

// saves group
bot.command('setgroup', ctx => {
  // takes group name (second after command)
  const group = ctx.update.message.text.split(' ')[1];
  if (!group) {
    ctx.reply('Specify your group please');
  }
  // Checks if there is a group with this name on server
  hasGroup(group, result => {
    // It gives out a list of suggestions, and if we have our group in there it exists
    if (result && result.includes(group)) {
      groups[ctx.update.message.chat.id] = group;
      ctx.reply('Group saved!');
    } else {
      // Why not giving out a list of possible suggestions?
      ctx.reply('No such group! ' + (result && result.length ? `Try: ${result.join(', ')}` : ''))
    }
  });
})

bot.command('now', ({ reply, update }) => {
  group = groups[update.message.chat.id];
  if (!group) {
    reply('It appears you did not set a group');
  }

  getPage(group, ({ window }) => {
    // getting closest pair by it's highlight
    const nextpair = window.document.getElementsByClassName('closest_pair')[0];
    reply(`Next pair is ${getInfo(nextpair)}`);
  })
});

bot.command('today', ({ reply, update }) => {
  group = groups[update.message.chat.id];
  if (!group) {
    reply('It appears you did not set a group');
  }

  getPage(group, ({ window }) => {
    // getting today's pairs by their highlight
    const today = Array.from(window.document.getElementsByClassName('day_backlight'))
      .filter(el => el.innerHTML.length > 0); // cancel the empty ones

    // getting the info and aligning properly
    reply(`Today's pairs are:\n\n${today.map(p => getInfo(p)).map(el => el + '\n\n').join('')}`);
  });
});

bot.command('all', ({ reply, update }) => {
  group = groups[update.message.chat.id];
  if (!group) {
    reply('It appears you did not set a group');
  }

  getPage(group, ({ window }) => {
    const tableElements = [
      window.document.getElementById('ctl00_MainContent_FirstScheduleTable'),
      window.document.getElementById('ctl00_MainContent_SecondScheduleTable'),
    ];
    if (!tableElements.every(Boolean)) {
      reply('Got a bad response from rozklad.kpi.ua. Try again a bit later please');
      return;
    }
    const timetable = tableElements.map(el => el.firstElementChild);
    timetable.forEach((tt, weekno) => {
      let pairsrows = Array.from(tt ? tt.childNodes : []) // table rows
        .map(pair => Array.from(pair.childNodes) // to arrays of table cells
          .filter((el, i, arr) => i && i !== arr.length - 1)); // filtering out text elements (first and last)
      const weekdays = pairsrows.shift(); // first row is weekdays
      let repl = `Week number ${weekno+1}\n\n`;

      weekdays.forEach((wd, i) => {
        if (!i) return;

        happeningPairs = pairsrows
          .map(pair => pair[i] ? getInfo(pair[i]) + '\n\n' : '') // for each pair row get pair for this weekday
          .filter(el => el.length > 11); // filter empty ones

        if (happeningPairs.length) {
          repl += `${wd.textContent}:\n\n`; // weekday name
          repl += happeningPairs.join('');
        }
      });
      reply(repl);
    })
  });
})

bot.telegram.setWebhook('scholarship-bot.zorenkovika.now.sh/heyman');

bot.startWebhook('/heyman', null, 5000);

bot.launch().then(() => console.log('bot started'));

http.createServer((req, res) => {res.end('YAY')}).listen(process.env.PORT);

function hasGroup(prefixText, callback) {
  const json = { count: 10, prefixText };
  request.post(
    'http://rozklad.kpi.ua/Schedules/ScheduleGroupSelection.aspx/GetGroups', { json },
    (err, res) => callback(res.body.d),
  );
}

function getInfo(tableCell) {
  if (!tableCell) {
    return '';
  }
  // The info is in the anchor elements of the td
  const info = Array.from(tableCell.getElementsByClassName('plainLink')).map(el => el.textContent).join(', ');
  // Time time is in start of the row, so we go there via a parent
  const timeinfo = tableCell.parentNode.firstElementChild.lastChild.textContent;
  return `${info} on ${timeinfo}`;
}

function getPage(group, callback) {
  getHiddenFormItems(items => {
    getTrueUrl(group, items, (url) => {
      request(url, (err, res, body) => {
        // console.log(body);
        callback(new jsdom.JSDOM(body));
      })
    })
  })
}

function getHiddenFormItems(callback) {
  // rozklad.kpi.ua has some magic to make parsing harder, here we get a page to know the magic keys
  const options = {
    hostname,
    path: '/Schedules/ScheduleGroupSelection.aspx',
    method: 'GET'
  };
  http.request(options, (res) => {
    let page = '';
    res.on('data', (chunk) => {
      page += chunk;
    });
    res.on('end', () => {
      const doc = new jsdom.JSDOM(page);
      const hiddenItems = {
        '__VIEWSTATE': doc.window.document.getElementById('__VIEWSTATE').getAttribute('value'),
        '__EVENTVALIDATION': doc.window.document.getElementById('__EVENTVALIDATION').getAttribute('value')
      };
      callback(hiddenItems);
    })
  }).end();
}

function getTrueUrl(group, hiddenItems, callback) {
  // finaly getting the link to the timetable page via a formdata query
  hiddenItems.ctl00$MainContent$ctl00$txtboxGroup = group;
  hiddenItems.ctl00$MainContent$ctl00$btnShowSchedule = 'Розклад занять';
  const postData = querystring.stringify(hiddenItems);
  const options = {
    hostname: hostname,
    path: '/Schedules/ScheduleGroupSelection.aspx',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)
    }
  };
  const req = http.request(options, (res) => {
    if (res.headers.location) {
      callback(`http://${hostname}${res.headers.location}`);
    } else {
      callback(null);
    }
  })
  req.write(postData);
  req.end();
}