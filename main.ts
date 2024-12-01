import { default as RCON } from "rcon-srcds";
import { XMLParser } from "fast-xml-parser";
import { decode } from "html-entities";

const parser = new XMLParser(
  {
    ignoreAttributes: false,
    alwaysCreateTextNode: true,
    processEntities: false,
    //FIX: while changing songs VLC may fail to respond with stream info
    //this causes FXP to assume that category should be an object instead of array
    isArray: (
      _tagName: string,
      jPath: string,
      _isLeafNode: boolean,
      _isAttribute: boolean,
    ) => {
      return jPath === "root.information.category";
    },
  },
);
const possibleChars: string = "abcdefghijklmnopqrstuvwxyz";
const TF2Password: string = generateRandomString();
const VLCPassword: string = generateRandomString();

//start of configuration
const conLogPath: string =
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Team Fortress 2\\tf\\console.log";
const TF2Path: string =
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Team Fortress 2\\tf_win64.exe";
const VLCPath: string = "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe";
const playlistPath: string = "E:\\Hella Gud Christmas Playlist\\christmas.m3u";
const TF2Port: number = 27015;
const VLCPort: number = 9090;
const refreshMilliseconds: number = 400;
const maxAuthRetries: number = 10;
const TF2Args: string[] = `-steam
-novid
-nojoy
-nosteamcontroller
-nohltv
-particles 1
-precachefontchars
-condebug
-conclearlog
-usercon
+ip 127.0.0.1
+sv_rcon_whitelist_address 127.0.0.1
+rcon_password ${TF2Password}
+hostport ${TF2Port}
+net_start`.split("\n");
const VLCArgs: string[] = `${playlistPath}
--http-host=127.0.0.1
--http-port=${VLCPort}
--http-password=${VLCPassword}`.split("\n");
//end of configuration

let fileSize = 0;
let firstRead = false;
let VLCPaused = false;

async function readStreamAsText(stream: ReadableStream, format: string) {
  const decoder: TextDecoder = new TextDecoder(format);
  let text: string = "";
  let wholeBufferLength: number = 0;
  for await (const chunk of stream) {
    text += decoder.decode(chunk, { stream: true });
    wholeBufferLength += chunk.length;
  }
  return { text: text, size: wholeBufferLength };
}

async function readNewLines() {
  using conLogFileHandle = await Deno.open(conLogPath, { read: true });
  await conLogFileHandle.seek(fileSize, Deno.SeekMode.Start);
  const streamData = await readStreamAsText(conLogFileHandle.readable, "utf-8");
  const allNewText = streamData.text;
  fileSize += streamData.size;
  const lines = allNewText.split("\r\n");
  // Wait for a while before checking for new data
  setTimeout(() => {
    readNewLines();
    checkMetaData();
  }, refreshMilliseconds);
  if (streamData.size === 0) {
    return;
  }
  if (!firstRead) {
    firstRead = true;
    return;
  }
  for (let i = 0; i < lines.length; i++) {
    if (
      lines[i].startsWith(
        "(Demo Support) Start recording demos",
      )
    ) {
      sendTF2Command("+voicerecord;-voicerecord");
    }
    /*We use includes instead of startsWith because of a bug in the source engine where it doesn't guarantee that
    consecutive echo commands should be on their own line*/
    if (
      lines[i].startsWith("(Demo Support) End recording") ||
      lines[i].includes(`${VLCPauseWord} `) ||
      lines[i].startsWith("You have switched to team")
    ) {
      pauseVLC(true);
      sendTF2Command("-voicerecord");
    }
    if (lines[i].includes(`${VLCNextWord} `)) {
      sendVLCCommand("pl_next");
      sendTF2Command("+voicerecord");
    }
    if (lines[i].includes(`${VLCPlayWord} `)) {
      pauseVLC(false);
      sendTF2Command("+voicerecord");
    }
    if (lines[i].includes(`${VLCInfoWord} `)) {
      announceSong(true);
    }
  }
  return;
}

const teamFortressCommand = new Deno.Command(TF2Path, { args: TF2Args });
const teamFortress = teamFortressCommand.spawn();
teamFortress.output().then(() => {
  Deno.exit(0);
});
const VLCCommand = new Deno.Command(VLCPath, { args: VLCArgs });
const VLC = VLCCommand.spawn();
VLC.output().then(() => {
  Deno.exit(0);
});

globalThis.addEventListener("unload", () => {
  VLC.kill();
  teamFortress.kill();
});

const RCONClient = new RCON.default(
  {
    port: TF2Port,
    encoding: "utf8",
  },
);

function generateRandomString(): string {
  const randNumbers: Uint32Array = crypto.getRandomValues(new Uint32Array(32));

  let randomString: string = "";
  for (let i: number = 0; i < randNumbers.length; i++) {
    randomString += possibleChars[randNumbers[i] % possibleChars.length];
  }
  return randomString;
}

const VLCPlayWord: string = generateRandomString();
const VLCPauseWord: string = generateRandomString();
const VLCInfoWord: string = generateRandomString();
const VLCNextWord: string = generateRandomString();
let authRetry: number;
let authRetryCounter: number = 0;

function tryAuth() {
  authRetry = setTimeout(function () {
    console.log("Attempting RCON connection to TF2");
    RCONClient.authenticate(TF2Password)
      .then(RCONSUCCESS)
      .catch(function (e) {
        console.error(e);
        tryAuth();
      });
    authRetryCounter--;
    if (authRetryCounter === maxAuthRetries) {
      throw "Could not establish RCON connection to TF2";
    }
  }, 5000);
}

tryAuth();

let chatString = "";
let timestampString = " at 0:00/0:00";

async function RCONSUCCESS() {
  console.log("authenticated");
  console.log("VLC HTTP Password: " + VLCPassword);
  sendTF2Command(`alias VLCPLAY "echo ${VLCPlayWord}"
        alias VLCPAUSE "echo ${VLCPauseWord}"
        alias VLCINFO "echo ${VLCInfoWord}"
        alias VLCNEXT "echo ${VLCNextWord}"
        voice_loopback 1`);
  clearInterval(authRetry);
  await pauseVLC(true);
  await readNewLines();
}

async function checkMetaData() {
  const response = await fetch(
    `http://:${VLCPassword}@127.0.0.1:${VLCPort}/requests/status.xml`,
  );
  if (!response.ok || response.body === null) {
    return false;
  }
  const jObj = parser.parse(await response.text());

  timestampString = ` Currently at ${
    convertSecondsToTimestamp(jObj.root.time["#text"], 1)
  }/${convertSecondsToTimestamp(jObj.root.length["#text"], 1)}.`;
  /*FIXME: if the metadata request is recieved after VLCPAUSE/PLAY
        is run but before VLC recieves the request, our client will fall out of
        sync for 1 frame*/
  if (jObj.root.state["#text"] != "playing") {
    VLCPaused = true;
    return true;
  }
  VLCPaused = false;
  let metaInfo = [];
  const metaData = ["NO ARTIST METADATA", "NO TITLE METADATA"];
  for (
    let i = 0;
    i < jObj.root.information
      .category
      .length;
    i++
  ) {
    if (
      jObj.root.information.category[i][
        "@_name"
      ] == "meta"
    ) {
      metaInfo = jObj.root.information
        .category[i].info;
    }
  }
  for (let i = 0; i < metaInfo.length; i++) {
    if (metaInfo[i]["@_name"] == "artist") {
      metaData[0] = metaInfo[i]["#text"];
    }
    if (metaInfo[i]["@_name"] == "title") {
      metaData[1] = metaInfo[i]["#text"];
    }
  }
  let tempString = ` Playing: ${metaData[0]} - ${metaData[1]}.`;
  //this has to be decoded twice, VLC WHY!!!!! (&amp;amp;)
  tempString = decode(decode(
    tempString,
  ));
  if (chatString == tempString) {
    return true;
  }
  chatString = tempString;
  announceSong(false);
  return true;
}

function announceSong(timestamp: boolean | undefined) {
  if (!timestamp) {
    RCONClient.execute(formatChatMessage(`Now${chatString}`));
  } else {
    RCONClient.execute(formatChatMessage(
      `Currently${chatString + timestampString}`,
    ));
  }
}

function sendVLCCommand(command: string) {
  return fetch(
    `http://:${VLCPassword}@127.0.0.1:${VLCPort}/requests/status.xml?command=${command}`,
    { method: "HEAD" },
  );
}

function sendTF2Command(command: string) {
  RCONClient.execute(command);
}

function pauseVLC(pause: boolean) {
  if (VLCPaused != pause) {
    sendVLCCommand("pl_pause");
    VLCPaused = pause;
  }
}

function formatChatMessage(message: string) {
  message.replaceAll('"', "''");
  if (message.length > 127) {
    message = message.slice(0, 124);
    message += "...";
  }
  return "say_team " + message;
}

function convertSecondsToTimestamp(
  seconds: number,
  minSeparators: number | undefined,
) {
  if (seconds < 0) {
    seconds = 0;
  }
  if (minSeparators === undefined || minSeparators < 0) {
    minSeparators = 0;
  }
  minSeparators = Math.floor(minSeparators);
  const separators = Math.max(
    Math.floor(
      Math.max(Math.log(seconds), 0) / Math
        .log(60),
    ),
    minSeparators,
  );
  const outputTimes = [];
  for (let i = separators; i >= 0; i--) {
    const addedSegment = (Math.floor(seconds % 60))
      .toString();
    if (i === 0) {
      outputTimes.unshift(addedSegment.padStart(1, "0"));
    } else {
      outputTimes.unshift(addedSegment.padStart(2, "0"));
    }
    seconds /= 60;
  }
  return outputTimes.join(":");
}
