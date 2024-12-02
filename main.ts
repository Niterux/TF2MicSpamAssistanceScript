import {default as RCON} from "rcon-srcds";
import {XMLParser} from "fast-xml-parser";
import {decode} from "html-entities";

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
            return jPath === "root.information.category" || jPath === "root.information.category.info";
        },
    },
);
const possibleChars: string = "abcdefghijklmnopqrstuvwxyz";
const TF2Password: string = generateRandomString();
const VLCPassword: string = generateRandomString();
console.log(`VLC HTTP Password: ${VLCPassword}`);

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
--extraintf=http
--http-host=127.0.0.1
--http-port=${VLCPort}
--http-password=${VLCPassword}`.split("\n");
//end of configuration

let fileSize = 0;
let firstRead = false;

async function readStreamAsText(stream: ReadableStream, format: string) {
    const decoder: TextDecoder = new TextDecoder(format);
    let text: string = "";
    let wholeBufferLength: number = 0;
    for await (const chunk of stream) {
        text += decoder.decode(chunk, {stream: true});
        wholeBufferLength += chunk.length;
    }
    return {text: text, size: wholeBufferLength};
}

async function readNewLines() {
    using conLogFileHandle = await Deno.open(conLogPath, {read: true});
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
            await sendVLCCommand("pl_forcepause");
            sendTF2Command("-voicerecord");
        }
        if (lines[i].includes(`${VLCNextWord} `)) {
            await sendVLCCommand("pl_next");
            sendTF2Command("+voicerecord");
        }
        if (lines[i].includes(`${VLCPlayWord} `)) {
            await sendVLCCommand("pl_forceresume");
            sendTF2Command("+voicerecord");
        }
        if (lines[i].includes(`${VLCInfoWord} `)) {
            announceSong(true);
        }
    }
    return;
}

const teamFortress = new Deno.Command(TF2Path, {args: TF2Args}).spawn();
teamFortress.output().then(() => {
    Deno.exit(0);
});
const VLC = new Deno.Command(VLCPath, {args: VLCArgs}).spawn();
VLC.output().then(() => {
    Deno.exit(0);
});
Deno.addSignalListener("SIGINT", beforeUnload);
globalThis.addEventListener("unload", beforeUnload);

function beforeUnload() {
    try {
        VLC.kill();
    } catch (error) {

    }
    try {
        teamFortress.kill();
    } catch (error) {

    }
}

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
        authRetryCounter--;
        RCONClient.authenticate(TF2Password)
            .then(RCONSUCCESS)
            .catch(function (e) {
                if (e.message.includes("ECONNREFUSED")) {
                    tryAuth();
                } else if (e.message.includes("Unable to authenticate")) {
                    console.error("UNABLE TO AUTHENTICATE, TRY CLOSING TF2");
                    Deno.exit(1);
                } else {
                    console.error(e);
                    Deno.exit(1);
                }
            });
        if (authRetryCounter === maxAuthRetries) {
            throw "Could not establish RCON connection to TF2";
        }
    }, 5000);
}

tryAuth();

let chatString = "";
let timestampString = " at 0:00/0:00";

async function RCONSUCCESS() {
    console.log("Authenticated with TF2");
    sendTF2Command(`alias VLCPLAY "echo ${VLCPlayWord}"
        alias VLCPAUSE "echo ${VLCPauseWord}"
        alias VLCINFO "echo ${VLCInfoWord}"
        alias VLCNEXT "echo ${VLCNextWord}"
        voice_loopback 1`);
    clearInterval(authRetry);
    await sendVLCCommand("pl_forcepause");
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
    if (jObj.root.state["#text"] != "playing") {
        return true;
    }
    let metaInfo = [];
    let artistName = ""
    let titleName = ""
    let fileName = ""
    for (
        const cat of jObj.root.information.category
        ) {
        if (cat["@_name"] === "meta") {
            metaInfo = cat.info;
        }
    }
    for (let info of metaInfo) {
        switch (info["@_name"]) {
            case "artist":
                artistName = info["#text"];
                break;
            case "title":
                titleName = info["#text"];
                break;
            case "filename":
                fileName = info["#text"];
                break;
        }
    }
    let tempString: string;
    let incompleteMeta: boolean = (artistName === "" || titleName === "")
    if (incompleteMeta) {
        tempString = ` Playing: ${fileName}.`;
    } else {
        tempString = ` Playing: ${artistName} - ${titleName}.`;
    }

    //this has to be decoded twice, VLC WHY!!!!! (&amp;amp;)
    tempString = decode(decode(tempString));
    if (chatString === tempString) {
        return true;
    }
    if (incompleteMeta) {
        console.warn(`Invalid metadata in: ${fileName}, title: ${titleName}, artist: ${artistName}.
fix this using Mp3tag or similar.`);
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
        {method: "HEAD"},
    );
}

function sendTF2Command(command: string) {
    RCONClient.execute(command);
}

/**
 * Formats a message to be a TF2 team chat command.
 * @param message original text to be converted to a command
 */
function formatChatMessage(message: string) {
    message.replaceAll('"', "''");
    if (message.length > 127) {
        message = message.slice(0, 124);
        message += "...";
    }
    return "say_team " + message;
}

/**
 * Returns a string of the seconds formatted as a timestamp (5:54)
 * @param seconds Seconds to use for the calculation.
 * @param minSeparators Minimum amount of ":" in the result.
 */
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
    const calculatedSeparators = Math.floor(
        Math.max(Math.log(seconds), 0) / Math.log(60),
    );
    const separators = Math.max(
        calculatedSeparators,
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
