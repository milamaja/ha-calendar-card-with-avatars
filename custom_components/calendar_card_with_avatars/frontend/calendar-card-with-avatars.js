/*
 * Calendar Card with Avatars, served by the Calendar Card with Avatars
 * integration.
 *
 * A seven-day agenda like Home Assistant's calendar card list view, with a
 * picture in front of each event instead of a small dot:
 *   - "[Name]" in an event title that matches a person in Home Assistant is
 *     replaced by that person's picture;
 *   - waste collections from the Afvalbeheer integration show the picture of
 *     the matching waste type;
 *   - a calendar can be linked to a person or to an uploaded picture;
 *   - picture rules match words in event titles.
 * Everything is set up in the card editor.
 */

const VERSION = "1.1.5";
const CARD_TYPE = "calendar-card-with-avatars";
const EDITOR_TYPE = "calendar-card-with-avatars-editor";
const DEFAULT_DAYS = 7;
const DEFAULT_ROWS = 6;
const REFRESH_MS = 5 * 60 * 1000;
const WASTE_CACHE_KEY = "calendar-card-with-avatars:waste";

const TEXT = {
  en: {
    name: "Calendar Card with Avatars",
    description: "A seven-day agenda with people's pictures and waste icons in front of the events.",
    today: "Today",
    all_day: "all-day",
    no_events: "No events in this period",
    add_calendar: "Add a calendar in the card editor.",
    load_error: "Could not load",
    title: "Title",
    calendars: "Calendars",
    entity: "Calendar",
    color: "Color",
    person: "Person (their picture in front of every event)",
    picture: "Picture (in front of every event)",
    days: "Days to show",
    pictures_section: "Pictures",
    name_pictures: "Replace [Name] in event titles with the person's picture",
    waste_pictures: "Waste pictures for Afvalbeheer collections",
    picture_rules: "Picture rules",
    text: "Event title contains",
    rule_entity: "Picture of entity",
    rule_picture: "Or this picture",
    height_section: "Height",
    rows: "Height (rows)",
    rows_helper: "Used instead of the height in the Layout tab, so the heights below can change it.",
    heights: "Other heights",
    heights_helper: "The first one whose condition is met is used; otherwise the height above.",
    height_rows: "Height (rows)",
    height_entity: "When entity",
    height_state: "has state",
    height_state_not: "or does not have state",
  },
  nl: {
    name: "Calendar Card with Avatars",
    description: "Een agenda van zeven dagen met foto's van personen en afvalpictogrammen voor de afspraken.",
    today: "Vandaag",
    all_day: "hele dag",
    no_events: "Geen afspraken in deze periode",
    add_calendar: "Voeg een agenda toe in de kaarteditor.",
    load_error: "Kon niet laden",
    title: "Titel",
    calendars: "Agenda's",
    entity: "Agenda",
    color: "Kleur",
    person: "Persoon (diens foto voor elke afspraak)",
    picture: "Afbeelding (voor elke afspraak)",
    days: "Aantal dagen",
    pictures_section: "Afbeeldingen",
    name_pictures: "[Naam] in de titel vervangen door de foto van die persoon",
    waste_pictures: "Afvalpictogrammen voor ophaaldagen van Afvalbeheer",
    picture_rules: "Afbeeldingsregels",
    text: "Titel bevat",
    rule_entity: "Afbeelding van entiteit",
    rule_picture: "Of deze afbeelding",
    height_section: "Hoogte",
    rows: "Hoogte (rijen)",
    rows_helper: "Wordt gebruikt in plaats van de hoogte in het tabblad Indeling, zodat de hoogtes hieronder die kunnen wijzigen.",
    heights: "Andere hoogtes",
    heights_helper: "De eerste waarvan de voorwaarde klopt wordt gebruikt; anders de hoogte hierboven.",
    height_rows: "Hoogte (rijen)",
    height_entity: "Als entiteit",
    height_state: "de status heeft",
    height_state_not: "of niet de status heeft",
  },
};

const text = (hass, key) => {
  const lang = ((hass && hass.language) || navigator.language || "en").slice(0, 2);
  return (TEXT[lang] || TEXT.en)[key] || TEXT.en[key] || key;
};

// ---------------------------------------------------------------- dates

// Dates are grouped and shown in the time zone the user chose in their
// Home Assistant profile (browser or server).
const timeZoneOf = (hass) =>
  hass && hass.locale && hass.locale.time_zone === "server" && hass.config
    ? hass.config.time_zone
    : undefined;

const dayKeyFormatters = {};
const dayKey = (date, timeZone) => {
  const id = timeZone || "local";
  if (!dayKeyFormatters[id]) {
    dayKeyFormatters[id] = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
  return dayKeyFormatters[id].format(date);
};

// Calendar arithmetic on "YYYY-MM-DD" keys, independent of time zones.
const keyToUtc = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const addDays = (key, days) => {
  const date = keyToUtc(key);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const hourOptions = (hass) => {
  const format = hass && hass.locale && hass.locale.time_format;
  if (format === "12") return { hour12: true };
  if (format === "24") return { hourCycle: "h23" };
  if (format === "system") {
    const cycle = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hourCycle;
    return cycle ? { hourCycle: cycle } : {};
  }
  return {};
};

const language = (hass) => (hass && hass.locale && hass.locale.language) || (hass && hass.language) || navigator.language;

// ---------------------------------------------------------------- colors

const cssColor = (color) =>
  !color
    ? undefined
    : /^(#|rgb|hsl|var\()/i.test(color)
      ? color
      : `var(--${color}-color, ${color})`;

// ---------------------------------------------------------------- titles

const normalize = (value) => (value || "").toString().trim().toLowerCase();

// People in Home Assistant, by full name and by first name.
const peopleIndex = (hass) => {
  const index = {};
  Object.values(hass.states).forEach((stateObj) => {
    if (!stateObj.entity_id.startsWith("person.")) return;
    const name = stateObj.attributes.friendly_name || "";
    const full = normalize(name);
    const first = normalize(name.split(/\s+-\s+|\s+/)[0]);
    if (full && !index[full]) index[full] = stateObj;
    if (first && !index[first]) index[first] = stateObj;
  });
  return index;
};

// "[Alex] Dentist" -> people [Alex], title "Dentist". Only brackets whose
// names all belong to people in Home Assistant are taken out.
const splitPeople = (title, people) => {
  const found = [];
  const rest = title.replace(/\s*\[([^\]]+)\]\s*/g, (match, inner) => {
    const names = inner.split(/\s*(?:,|&|\+|\/)\s*/).filter(Boolean);
    const matched = names.map((n) => people[normalize(n)]);
    if (!names.length || matched.some((p) => !p)) return match;
    matched.forEach((p) => {
      if (!found.includes(p)) found.push(p);
    });
    return " ";
  });
  return { people: found, title: rest.replace(/\s{2,}/g, " ").trim() || title };
};

// ---------------------------------------------------------------- pictures

const mediaCache = {};
const resolvePicture = async (hass, picture) => {
  if (!picture) return undefined;
  if (typeof picture === "string") return picture;
  const id = picture.media_content_id;
  if (!id) return undefined;
  const upload = id.match(/^media-source:\/\/image_upload\/(.+)$/);
  if (upload) return `/api/image/serve/${upload[1]}/256x256`;
  if (!mediaCache[id]) {
    mediaCache[id] = hass
      .callWS({ type: "media_source/resolve_media", media_content_id: id })
      .then((result) => result.url)
      .catch(() => undefined);
  }
  return mediaCache[id];
};

const initials = (name) =>
  (name || "?")
    .split(/\s+/)
    .filter((part) => /^[0-9A-Za-z\u00C0-\u024F]/.test(part))
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("") || "?";

// ---------------------------------------------------------------- waste

// Afvalbeheer's calendar events carry only the (possibly renamed) waste type,
// and its sensors carry the picture and the next collection date. Match an
// event to a sensor by the waste type in the sensor name, or else by date:
// the sensor's next collection is the event's day. Matches are remembered,
// so later collections of the same type find their picture too.
let wasteMemory;
const loadWasteMemory = () => {
  if (wasteMemory) return wasteMemory;
  try {
    wasteMemory = JSON.parse(localStorage.getItem(WASTE_CACHE_KEY) || "{}");
  } catch (_err) {
    wasteMemory = {};
  }
  return wasteMemory;
};
const rememberWaste = (calendar, summary, entityId) => {
  const memory = loadWasteMemory();
  memory[calendar] = memory[calendar] || {};
  if (memory[calendar][summary] === entityId) return;
  memory[calendar][summary] = entityId;
  try {
    localStorage.setItem(WASTE_CACHE_KEY, JSON.stringify(memory));
  } catch (_err) {
    // Remembering is a convenience; matching works without it.
  }
};

const wasteSensors = (hass, calendarId) => {
  const entities = hass.entities || {};
  const calendar = entities[calendarId];
  if (!calendar || calendar.platform !== "afvalbeheer") return [];
  const calendarName = hass.states[calendarId]
    ? hass.states[calendarId].attributes.friendly_name || ""
    : "";
  return Object.values(entities)
    .filter(
      (entry) =>
        entry.platform === "afvalbeheer" &&
        entry.entity_id.startsWith("sensor.") &&
        (!calendar.device_id || !entry.device_id || entry.device_id === calendar.device_id)
    )
    .map((entry) => hass.states[entry.entity_id])
    .filter((stateObj) => stateObj && stateObj.attributes.entity_picture && stateObj.attributes.Sort_date)
    .map((stateObj) => {
      let name = stateObj.attributes.friendly_name || "";
      if (calendarName && name.toLowerCase().startsWith(calendarName.toLowerCase())) {
        name = name.slice(calendarName.length);
      }
      return { stateObj, type: normalize(name), date: String(stateObj.attributes.Sort_date) };
    });
};

const matchWaste = (hass, calendarId, summary, key, eventsOnDay) => {
  const sensors = wasteSensors(hass, calendarId);
  if (!sensors.length) return undefined;
  const title = normalize(summary);
  const byName = sensors.filter(
    (s) => s.type && (new RegExp(`(^|\\W)${s.type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\W|$)`).test(title) || s.type === title)
  );
  let match = byName.length === 1 ? byName[0] : undefined;
  if (!match) {
    const date = key.replace(/-/g, "");
    const byDate = sensors.filter((s) => s.date === date);
    if (byDate.length === 1 && eventsOnDay === 1) match = byDate[0];
  }
  if (match) {
    rememberWaste(calendarId, summary, match.stateObj.entity_id);
    return match.stateObj;
  }
  const remembered = (loadWasteMemory()[calendarId] || {})[summary];
  return remembered ? hass.states[remembered] : undefined;
};

// ---------------------------------------------------------------- styles

const CARD_CSS = `
  :host {
    display: block;
    height: 100%;
  }
  ha-card {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .card-title {
    padding: 16px 16px 0;
    font-size: var(--ha-card-header-font-size, 24px);
    color: var(--ha-card-header-color, var(--primary-text-color));
  }
  .toolbar {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px 16px 12px;
  }
  .toolbar-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .range {
    font-size: 24px;
    line-height: 1.2;
    color: var(--primary-text-color);
  }
  .nav {
    display: flex;
    gap: 4px;
  }
  button {
    font-family: inherit;
    border: none;
    background: none;
    color: var(--primary-text-color);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .nav button {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .nav button:active,
  .today:active {
    background: var(--secondary-background-color);
  }
  .today {
    padding: 6px 12px;
    border-radius: 18px;
    font-size: 15px;
    font-weight: 500;
    color: var(--primary-color);
    align-self: flex-start;
  }
  .today[disabled] {
    cursor: default;
  }
  /* One grid for all rows, so times, pictures and titles line up. */
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    border-top: 1px solid var(--divider-color);
    display: grid;
    grid-template-columns: max-content 32px 1fr;
    column-gap: 12px;
    align-items: center;
    align-content: start;
  }
  .day,
  .message,
  .error {
    grid-column: 1 / -1;
  }
  .day {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 16px;
    font-size: 17px;
    font-weight: 400;
    color: var(--primary-text-color);
    border-bottom: 1px solid var(--divider-color);
  }
  .day:not(:first-child) {
    border-top: 1px solid var(--divider-color);
    margin-top: -1px;
  }
  .event {
    display: contents;
    font-size: 15px;
    color: var(--primary-text-color);
  }
  .event > * {
    padding-top: 5px;
    padding-bottom: 5px;
  }
  .time {
    padding-left: 16px;
    font-size: 15px;
    color: var(--primary-text-color);
    white-space: nowrap;
  }
  .marker {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
  }
  .avatars {
    display: flex;
  }
  .avatars > * + * {
    margin-left: -12px;
  }
  .avatar {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    object-fit: cover;
    box-sizing: border-box;
    border: 2px solid var(--card-background-color, var(--ha-card-background, #fff));
    flex: none;
  }
  .initials {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 600;
    color: #fff;
  }
  .picture {
    width: 30px;
    height: 30px;
    object-fit: contain;
  }
  .summary {
    min-width: 0;
    padding-right: 16px;
    font-size: 15px;
    color: var(--primary-text-color);
    overflow-wrap: anywhere;
  }
  .message {
    padding: 16px;
    color: var(--secondary-text-color);
  }
  .error {
    padding: 4px 16px;
    font-size: 13px;
    color: var(--error-color, #db4437);
  }
  ha-icon {
    --mdc-icon-size: 26px;
    color: var(--secondary-text-color);
  }
`;

const CHEVRON_LEFT = "M15.41,16.58L10.83,12L15.41,7.41L14,6L8,12L14,18L15.41,16.58Z";
const CHEVRON_RIGHT = "M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z";
const svgIcon = (path) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="${path}"/></svg>`;

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------------------------------------------------------------- card

const calendarsOf = (config) =>
  (config.calendars || config.entities || [])
    .map((item) => (typeof item === "string" ? { entity: item } : item))
    .filter((item) => item && item.entity);

// ---------------------------------------------------------------- height

// Conditions in the format of Home Assistant's card visibility conditions,
// plus a short form on the height itself: { entity, state, state_not }.
const asList = (value) => (Array.isArray(value) ? value : value === undefined ? [] : [value]).map(String);

const conditionMet = (cond, hass) => {
  if (!cond || typeof cond !== "object") return false;
  const kind = cond.condition || (cond.entity ? "state" : undefined);
  const stateObj = cond.entity ? hass.states[cond.entity] : undefined;
  switch (kind) {
    case "state": {
      if (!stateObj) return false;
      if (cond.state !== undefined && !asList(cond.state).includes(stateObj.state)) return false;
      if (cond.state_not !== undefined && asList(cond.state_not).includes(stateObj.state)) return false;
      return true;
    }
    case "numeric_state": {
      const value = stateObj ? Number(stateObj.state) : NaN;
      if (isNaN(value)) return false;
      const bound = (b) => (typeof b === "string" && hass.states[b] ? Number(hass.states[b].state) : Number(b));
      if (cond.above !== undefined && !(value > bound(cond.above))) return false;
      if (cond.below !== undefined && !(value < bound(cond.below))) return false;
      return true;
    }
    case "screen":
      return Boolean(cond.media_query) && window.matchMedia(cond.media_query).matches;
    case "user":
      return Boolean(hass.user) && asList(cond.users).includes(hass.user.id);
    case "and":
      return (cond.conditions || []).every((c) => conditionMet(c, hass));
    case "or":
      return (cond.conditions || []).some((c) => conditionMet(c, hass));
    case "not":
      return !(cond.conditions || []).some((c) => conditionMet(c, hass));
    default:
      return false;
  }
};

// A height applies when its short-form entity condition (if any) and all its
// conditions are met. The first height that applies wins.
const heightApplies = (height, hass) => {
  if (!height || typeof height !== "object") return false;
  const checks = [...(height.entity ? [{ condition: "state", entity: height.entity, state: height.state, state_not: height.state_not }] : []),
    ...(height.conditions || [])];
  return checks.length > 0 && checks.every((c) => conditionMet(c, hass));
};

class CalendarCardWithAvatars extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._offset = 0;
    this._events = [];
    this._errors = [];
    this._loadId = 0;
    this._calendarStates = "";
    this._registryColors = {};
    this._pictures = {};
  }

  static getConfigElement() {
    return document.createElement(EDITOR_TYPE);
  }

  static getStubConfig(hass) {
    const calendars = Object.keys((hass && hass.states) || {})
      .filter((entityId) => entityId.startsWith("calendar."))
      .slice(0, 3)
      .map((entity) => ({ entity }));
    return { calendars };
  }

  setConfig(config) {
    if (!config || typeof config !== "object") {
      throw new Error("Invalid configuration");
    }
    this._config = config;
    this._offset = 0;
    this._pictures = {};
    this._render();
    if (this._hass) this._load();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._config) return;
    // Reload when a calendar changes (an event starts, ends or is edited).
    const states = calendarsOf(this._config)
      .map((c) => (hass.states[c.entity] ? hass.states[c.entity].last_updated : ""))
      .join("|");
    if (first || states !== this._calendarStates) {
      this._calendarStates = states;
      this._load();
    }
  }

  get hass() {
    return this._hass;
  }

  set layout(layout) {
    this._layout = layout;
  }

  get layout() {
    return this._layout;
  }

  getCardSize() {
    return 6;
  }

  // The dashboard asks for this on every redraw, so a height whose condition
  // changes applies right away. A height set in the Layout tab wins over this.
  getGridOptions() {
    return { columns: 12, rows: this._rows(), min_columns: 4, min_rows: 3 };
  }

  _rows() {
    const config = this._config || {};
    const hass = this._hass;
    const match = hass ? (config.heights || []).find((h) => heightApplies(h, hass)) : undefined;
    const rows = Number(match ? match.rows : config.rows) || DEFAULT_ROWS;
    return Math.max(1, Math.round(rows));
  }

  connectedCallback() {
    if (!this._timer) {
      this._timer = setInterval(() => this._load(), REFRESH_MS);
    }
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    this._timer = undefined;
  }

  _days() {
    const days = Number(this._config.days) || DEFAULT_DAYS;
    return Math.min(Math.max(Math.round(days), 1), 31);
  }

  _startKey() {
    const today = dayKey(new Date(), timeZoneOf(this._hass));
    return addDays(today, this._offset * this._days());
  }

  async _load() {
    if (!this._hass || !this._config) return;
    const loadId = ++this._loadId;
    // A calendar that no longer exists is skipped, as the built-in card does.
    const calendars = calendarsOf(this._config).filter((c) => this._hass.states[c.entity]);
    const startKey = this._startKey();
    // A day extra on both sides covers every time zone; events are grouped
    // by day in the user's time zone afterwards.
    const start = keyToUtc(addDays(startKey, -1)).toISOString();
    const end = keyToUtc(addDays(startKey, this._days() + 1)).toISOString();
    await this._loadColors(calendars);
    await this._loadPictures(calendars);
    const results = await Promise.all(
      calendars.map((calendar) =>
        this._hass
          .callApi(
            "GET",
            `calendars/${calendar.entity}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
          )
          .then((events) => ({ calendar, events }))
          .catch((err) => ({ calendar, error: err }))
      )
    );
    if (loadId !== this._loadId) return; // A newer load is on its way.
    this._events = [];
    this._errors = [];
    results.forEach(({ calendar, events, error }) => {
      if (error) {
        this._errors.push(calendar.entity);
        return;
      }
      events.forEach((event) => this._events.push({ calendar, event }));
    });
    this._render();
  }

  // Calendar colors set in Home Assistant (entity settings), like the
  // built-in calendar card.
  async _loadColors(calendars) {
    const missing = calendars.map((c) => c.entity).filter((id) => !(id in this._registryColors));
    if (!missing.length) return;
    try {
      const entries = await this._hass.callWS({ type: "config/entity_registry/get_entries", entity_ids: missing });
      missing.forEach((id) => {
        const entry = entries[id];
        this._registryColors[id] = entry && entry.options && entry.options.calendar ? entry.options.calendar.color : undefined;
      });
    } catch (_err) {
      missing.forEach((id) => {
        this._registryColors[id] = undefined;
      });
    }
  }

  async _loadPictures(calendars) {
    const rules = this._config.picture_rules || [];
    const jobs = [];
    calendars.forEach((calendar) => {
      if (calendar.picture && !(calendar.entity in this._pictures)) {
        jobs.push(resolvePicture(this._hass, calendar.picture).then((url) => {
          this._pictures[calendar.entity] = url;
        }));
      }
    });
    rules.forEach((rule, i) => {
      const key = `rule:${i}`;
      if (rule && rule.picture && !(key in this._pictures)) {
        jobs.push(resolvePicture(this._hass, rule.picture).then((url) => {
          this._pictures[key] = url;
        }));
      }
    });
    await Promise.all(jobs);
  }

  _color(calendar, index) {
    const color = calendar.color || this._registryColors[calendar.entity];
    if (color) return cssColor(color);
    return `var(--color-${(index % 54) + 1}, ${["#4269d0", "#f4bd4a", "#ff725c", "#6cc5b0"][index % 4]})`;
  }

  // Days with their events, in the user's time zone.
  _agenda() {
    const tz = timeZoneOf(this._hass);
    const startKey = this._startKey();
    const keys = Array.from({ length: this._days() }, (_, i) => addDays(startKey, i));
    const days = new Map(keys.map((key) => [key, []]));
    const calendars = calendarsOf(this._config);
    this._events.forEach(({ calendar, event }) => {
      const allDay = !!event.start.date;
      let firstKey;
      let lastKey;
      let start;
      let end;
      if (allDay) {
        firstKey = event.start.date;
        lastKey = addDays(event.end && event.end.date ? event.end.date : addDays(firstKey, 1), -1);
        if (lastKey < firstKey) lastKey = firstKey;
      } else {
        start = new Date(event.start.dateTime);
        end = new Date(event.end && event.end.dateTime ? event.end.dateTime : event.start.dateTime);
        firstKey = dayKey(start, tz);
        lastKey = end > start ? dayKey(new Date(end.getTime() - 1), tz) : firstKey;
      }
      const index = calendars.findIndex((c) => c.entity === calendar.entity);
      keys.forEach((key) => {
        if (key < firstKey || key > lastKey) return;
        days.get(key).push({
          calendar,
          index,
          event,
          allDay,
          start,
          end,
          part: firstKey === lastKey ? "single" : key === firstKey ? "first" : key === lastKey ? "last" : "middle",
        });
      });
    });
    days.forEach((items) =>
      items.sort((a, b) => {
        const aAll = a.allDay || a.part === "middle";
        const bAll = b.allDay || b.part === "middle";
        if (aAll !== bAll) return aAll ? -1 : 1;
        const aStart = a.part === "last" ? 0 : a.start ? a.start.getTime() : 0;
        const bStart = b.part === "last" ? 0 : b.start ? b.start.getTime() : 0;
        return aStart - bStart || String(a.event.summary).localeCompare(String(b.event.summary));
      })
    );
    return { keys, days };
  }

  _timeText(item) {
    const hass = this._hass;
    if (item.allDay || item.part === "middle") return text(hass, "all_day");
    const fmt = new Intl.DateTimeFormat(
      language(hass),
      Object.assign({ hour: "numeric", minute: "2-digit", timeZone: timeZoneOf(hass) }, hourOptions(hass))
    );
    const s = fmt.format(item.start);
    const e = fmt.format(item.end);
    // An event over midnight shows up to and from midnight on its days,
    // like Home Assistant's own calendar.
    const midnight = () => {
      const date = new Date(item.start.getTime());
      const parts = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "numeric", hourCycle: "h23", timeZone: timeZoneOf(hass) }).formatToParts(date);
      const h = Number(parts.find((x) => x.type === "hour").value) % 24;
      const m = Number(parts.find((x) => x.type === "minute").value);
      return fmt.format(new Date(date.getTime() - (h * 60 + m) * 60000));
    };
    if (item.part === "first") return `${s} - ${midnight()}`;
    if (item.part === "last") return `${midnight()} - ${e}`;
    return item.end > item.start ? `${s} - ${e}` : s;
  }

  _marker(item, people, eventsOnDay, dayKeyValue) {
    const hass = this._hass;
    const config = this._config;
    const avatarHtml = (person) => {
      const picture = person.attributes.entity_picture;
      const name = person.attributes.friendly_name || "";
      return picture
        ? `<img class="avatar" src="${escapeHtml(picture)}" alt="${escapeHtml(name)}" title="${escapeHtml(name)}">`
        : `<span class="avatar initials" style="background:${this._color(item.calendar, item.index)}" title="${escapeHtml(name)}">${escapeHtml(initials(name))}</span>`;
    };
    const imageHtml = (url, label) =>
      `<img class="picture" src="${escapeHtml(url)}" alt="${escapeHtml(label || "")}">`;

    if (people.length) {
      return `<div class="avatars">${people.slice(0, 3).map(avatarHtml).join("")}</div>`;
    }
    const summary = normalize(item.event.summary);
    const rules = config.picture_rules || [];
    for (let i = 0; i < rules.length; i += 1) {
      const rule = rules[i];
      if (!rule || !rule.text || !summary.includes(normalize(rule.text))) continue;
      if (this._pictures[`rule:${i}`]) return imageHtml(this._pictures[`rule:${i}`], rule.text);
      const stateObj = rule.entity && hass.states[rule.entity];
      if (stateObj && stateObj.entity_id.startsWith("person.")) return avatarHtml(stateObj);
      if (stateObj && stateObj.attributes.entity_picture) return imageHtml(stateObj.attributes.entity_picture, rule.text);
      if (stateObj && stateObj.attributes.icon) return `<ha-icon icon="${escapeHtml(stateObj.attributes.icon)}"></ha-icon>`;
    }
    if (config.waste_pictures !== false && item.allDay) {
      const sensor = matchWaste(hass, item.calendar.entity, item.event.summary, dayKeyValue, eventsOnDay);
      if (sensor) return imageHtml(sensor.attributes.entity_picture, item.event.summary);
    }
    const person = item.calendar.person && hass.states[item.calendar.person];
    if (person) return avatarHtml(person);
    if (this._pictures[item.calendar.entity]) {
      return `<img class="avatar" src="${escapeHtml(this._pictures[item.calendar.entity])}" alt="">`;
    }
    return `<span class="dot" style="background:${this._color(item.calendar, item.index)}"></span>`;
  }

  _render() {
    if (!this._config) return;
    const hass = this._hass;
    const root = this.shadowRoot;
    if (!root.querySelector("ha-card")) {
      root.innerHTML = `<style>${CARD_CSS}</style><ha-card></ha-card>`;
    }
    const card = root.querySelector("ha-card");
    if (!hass) {
      card.innerHTML = "";
      return;
    }
    const lang = language(hass);
    const { keys, days } = this._agenda();
    const rangeFormat = new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    const first = keyToUtc(keys[0]);
    const last = keyToUtc(keys[keys.length - 1]);
    const range = keys.length > 1 && rangeFormat.formatRange ? rangeFormat.formatRange(first, last) : rangeFormat.format(first);
    const weekday = new Intl.DateTimeFormat(lang, { weekday: "long", timeZone: "UTC" });
    const longDate = new Intl.DateTimeFormat(lang, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    const people = this._config.name_pictures === false ? {} : peopleIndex(hass);

    let list = "";
    keys.forEach((key) => {
      const items = days.get(key);
      if (!items.length) return;
      const date = keyToUtc(key);
      list += `<div class="day"><span>${escapeHtml(weekday.format(date))}</span><span class="date">${escapeHtml(longDate.format(date))}</span></div>`;
      items.forEach((item) => {
        const split = splitPeople(String(item.event.summary || ""), people);
        const sameCalendar = items.filter((other) => other.calendar.entity === item.calendar.entity && other.allDay).length;
        list += `<div class="event"><span class="time">${escapeHtml(this._timeText(item))}</span><span class="marker">${this._marker(item, split.people, sameCalendar, key)}</span><span class="summary">${escapeHtml(split.title)}</span></div>`;
      });
    });
    if (!calendarsOf(this._config).length) {
      list = `<div class="message">${escapeHtml(text(hass, "add_calendar"))}</div>`;
    } else if (!list) {
      list = `<div class="message">${escapeHtml(text(hass, "no_events"))}</div>`;
    }
    const errors = this._errors
      .map((id) => `<div class="error">${escapeHtml(text(hass, "load_error"))}: ${escapeHtml(hass.states[id] ? hass.states[id].attributes.friendly_name || id : id)}</div>`)
      .join("");

    const scroll = card.querySelector(".list");
    const scrollTop = scroll && this._renderedOffset === this._offset ? scroll.scrollTop : 0;
    card.innerHTML = `
      ${this._config.title ? `<div class="card-title">${escapeHtml(this._config.title)}</div>` : ""}
      <div class="toolbar">
        <div class="toolbar-row">
          <span class="range">${escapeHtml(range)}</span>
          <span class="nav">
            <button class="prev" aria-label="previous">${svgIcon(CHEVRON_LEFT)}</button>
            <button class="next" aria-label="next">${svgIcon(CHEVRON_RIGHT)}</button>
          </span>
        </div>
        <button class="today" ${this._offset === 0 ? "disabled" : ""}>${escapeHtml(text(hass, "today"))}</button>
      </div>
      ${errors}
      <div class="list">${list}</div>`;
    card.querySelector(".list").scrollTop = scrollTop;
    this._renderedOffset = this._offset;
    card.querySelector(".prev").addEventListener("click", () => this._move(-1));
    card.querySelector(".next").addEventListener("click", () => this._move(1));
    card.querySelector(".today").addEventListener("click", () => this._move(0));
  }

  _move(step) {
    this._offset = step === 0 ? 0 : this._offset + step;
    this._render();
    this._load();
  }
}

// ---------------------------------------------------------------- editor

class CalendarCardWithAvatarsEditor extends HTMLElement {
  constructor() {
    super();
    this._config = {};
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  setConfig(config) {
    this._config = config || {};
    this._render();
  }

  _schema() {
    const hass = this._hass;
    const field = (name, selector) => ({ label: text(hass, name), selector });
    return [
      { name: "title", selector: { text: {} } },
      {
        name: "calendars",
        selector: {
          object: {
            multiple: true,
            label_field: "entity",
            fields: {
              entity: Object.assign(field("entity", { entity: { domain: "calendar" } }), { required: true }),
              color: field("color", { ui_color: { include_none: true } }),
              person: field("person", { entity: { domain: "person" } }),
              picture: field("picture", { media: { accept: ["image/*"], image_upload: true } }),
            },
          },
        },
      },
      { name: "days", selector: { number: { min: 1, max: 31, mode: "box" } } },
      {
        type: "expandable",
        name: "pictures_section",
        title: text(hass, "pictures_section"),
        icon: "mdi:account-circle-outline",
        flatten: true,
        schema: [
          { name: "name_pictures", selector: { boolean: {} } },
          { name: "waste_pictures", selector: { boolean: {} } },
          {
            name: "picture_rules",
            selector: {
              object: {
                multiple: true,
                label_field: "text",
                fields: {
                  text: Object.assign(field("text", { text: {} }), { required: true }),
                  entity: field("rule_entity", { entity: {} }),
                  picture: field("rule_picture", { media: { accept: ["image/*"], image_upload: true } }),
                },
              },
            },
          },
        ],
      },
      {
        type: "expandable",
        name: "height_section",
        title: text(hass, "height_section"),
        icon: "mdi:arrow-expand-vertical",
        flatten: true,
        schema: [
          { name: "rows", selector: { number: { min: 1, max: 24, mode: "box" } } },
          {
            name: "heights",
            selector: {
              object: {
                multiple: true,
                label_field: "entity",
                description_field: "rows",
                fields: {
                  rows: Object.assign(field("height_rows", { number: { min: 1, max: 24, mode: "box" } }), { required: true }),
                  // Not required: a height can also have conditions (YAML), which the editor keeps.
                  entity: field("height_entity", { entity: {} }),
                  state: field("height_state", { text: {} }),
                  state_not: field("height_state_not", { text: {} }),
                },
              },
            },
          },
        ],
      },
    ];
  }

  _layoutRows() {
    const options = this._config.grid_options;
    return options && typeof options.rows === "number" ? options.rows : undefined;
  }

  _data() {
    const config = this._config;
    return {
      title: config.title,
      calendars: calendarsOf(config),
      days: config.days || DEFAULT_DAYS,
      name_pictures: config.name_pictures !== false,
      waste_pictures: config.waste_pictures !== false,
      picture_rules: config.picture_rules || [],
      rows: config.rows || this._layoutRows() || DEFAULT_ROWS,
      heights: config.heights || [],
    };
  }

  _render() {
    if (!this._hass) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (schema) => text(this._hass, schema.name);
      this._form.computeHelper = (schema) =>
        ["rows", "heights"].includes(schema.name) ? text(this._hass, `${schema.name}_helper`) : undefined;
      this._form.addEventListener("value-changed", (ev) => this._changed(ev));
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.schema = this._schema();
    this._form.data = this._data();
  }

  _changed(ev) {
    ev.stopPropagation();
    const value = ev.detail.value;
    const config = Object.assign({}, this._config);
    delete config.entities; // The built-in card's list becomes "calendars".
    const set = (key, keep, val) => {
      if (keep) config[key] = val === undefined ? value[key] : val;
      else delete config[key];
    };
    set("title", !!value.title);
    set("calendars", true, (value.calendars || []).filter((c) => c && c.entity));
    set("days", value.days && Number(value.days) !== DEFAULT_DAYS);
    set("name_pictures", value.name_pictures === false);
    set("waste_pictures", value.waste_pictures === false);
    set("picture_rules", value.picture_rules && value.picture_rules.length);
    const heights = (value.heights || []).filter(
      (h) => h && Number(h.rows) > 0 && (h.entity || (Array.isArray(h.conditions) && h.conditions.length))
    );
    set("heights", heights.length > 0, heights);
    const rows = Number(value.rows) || undefined;
    const layoutRows = this._layoutRows();
    // A height in the Layout tab always wins. When other heights are used, or the
    // height is changed here, it moves here as the default height.
    const takeOver = layoutRows !== undefined && (heights.length > 0 || (rows !== undefined && rows !== layoutRows));
    if (takeOver) {
      const options = Object.assign({}, config.grid_options);
      delete options.rows;
      if (Object.keys(options).length) config.grid_options = options;
      else delete config.grid_options;
    }
    const layoutDecides = layoutRows !== undefined && !takeOver;
    set("rows", rows !== undefined && !layoutDecides && (rows !== DEFAULT_ROWS || heights.length > 0), rows);
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }
}

// ---------------------------------------------------------------- register

const register = () => {
  if (customElements.get(CARD_TYPE)) return;
  customElements.define(CARD_TYPE, CalendarCardWithAvatars);
  customElements.define(EDITOR_TYPE, CalendarCardWithAvatarsEditor);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: CARD_TYPE,
    name: text(undefined, "name"),
    description: text(undefined, "description"),
    preview: true,
    documentationURL: "https://github.com/milamaja/ha-calendar-card-with-avatars",
  });
  console.info(
    `%c CALENDAR-CARD-WITH-AVATARS %c ${VERSION} `,
    "color: white; background: #4269d0; font-weight: 700;",
    "color: #4269d0; background: white; font-weight: 700;"
  );
};

// Home Assistant replaces the browser's custom element registry while it
// starts. A card defined before that lands in the old registry, where
// dashboards cannot find it ("Custom element doesn't exist"). This file can
// load before Home Assistant has started, so register only once Home
// Assistant's own app element is defined, which happens after the swap.
if (customElements.get("home-assistant")) {
  register();
} else {
  customElements.whenDefined("home-assistant").then(register);
}
