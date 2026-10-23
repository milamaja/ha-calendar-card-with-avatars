# Calendar Card with Avatars for Home Assistant

A seven-day agenda for your dashboard, like the list view of Home Assistant's
own calendar card, but with a picture in front of every event instead of a
small dot: the person it is for, the bin that goes out, or a picture of your
choice.

Made for family dashboards and wall tablets: see at a glance who has what
this week. Everything is set up in the dashboard editor, no YAML needed.

## What you get

- A **Calendar Card with Avatars** card in the dashboard card picker: the next
  7 days (or another number of days), grouped per day, with buttons for the
  previous and next week and **Today**.
- Pictures in front of events, chosen in this order:
  1. **People in the title**: an event called `[Alex] Dentist` shows Alex's
     picture and the title `Dentist`, when Alex is a person in Home Assistant
     (Settings, People). `[Alex, Sam]` shows both. Names that are not a person
     stay in the title as they are.
  2. **Picture rules**: events whose title contains a word you choose get a
     picture you upload, or the picture of an entity or person.
  3. **Waste collections** from the
     [Afvalbeheer](https://github.com/pippyn/Home-Assistant-Sensor-Afvalbeheer)
     integration show the picture of the matching waste type.
  4. **A person linked to a calendar**: every event in that calendar shows
     their picture.
  5. **A picture linked to a calendar**, uploaded in the editor.
  6. Otherwise a dot in the calendar's colour, larger than in the built-in
     card.
- Calendar colours follow the colour set for each calendar in Home Assistant,
  or a colour you pick in the editor.
- The size is set in the editor's **Layout** tab, like any card in a sections
  dashboard; a fixed height scrolls, **auto** grows with the events.
- **Heights that depend on a condition**: one card can be 9 rows high normally
  and 8 rows while, for example, a warning card above it is shown. Set them
  under **Height** in the editor: a default height and other heights, each with
  an entity that has (or does not have) a certain state. The first one whose
  condition is met is used. No more copies of the card with visibility
  conditions for each height.
- Dates and times follow the language, time format and time zone of your
  Home Assistant profile.
- Its own integration icon (Home Assistant 2026.3 and newer).

<p><img src="https://raw.githubusercontent.com/milamaja/ha-calendar-card-with-avatars/main/images/card.png" width="420" alt="Calendar card: a week of events, with a person's picture in front of their events and the calendar colour for the others"></p>

## Installation

### HACS (custom repository)

[![Open your Home Assistant instance and open this repository inside HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=milamaja&repository=ha-calendar-card-with-avatars&category=integration)

The button opens this repository in HACS (it uses [My Home Assistant](https://www.home-assistant.io/integrations/my/), which is on by default). Or add it by hand:

1. In HACS, open the menu (three dots, top right) and choose **Custom repositories**.
2. Add `https://github.com/milamaja/ha-calendar-card-with-avatars` with category **Integration**.
3. Install **Calendar Card with Avatars** and restart Home Assistant
   (**Settings, System**, power icon top right, **Restart Home Assistant**).

Don't have HACS yet? See [the HACS installation guide](https://hacs.xyz/docs/use/).

### Manual

1. Copy the folder `custom_components/calendar_card_with_avatars` into the `custom_components` folder of your Home Assistant configuration directory.
2. Restart Home Assistant.

## Configuration

[![Open your Home Assistant instance and start setting up Calendar Card with Avatars.](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=calendar_card_with_avatars)

Or go to **Settings, Devices & services, Add integration** and search for
**Calendar Card with Avatars**. There is nothing to fill in: click **Submit**
and the card is available on all your dashboards.

Reload the dashboard once afterwards (on a wall tablet: reload the kiosk app,
or restart it).

## Adding the card

1. Open your dashboard, click the **pencil** (top right) to edit it.
2. Click **Add card** and search for **Calendar Card with Avatars**.
3. Under **Calendars**, add the calendars to show. Click the pencil next to a
   calendar to give it a colour, a person or a picture.
4. Under **Pictures**, switch the people and waste pictures on or off, and add
   picture rules.
5. In the **Layout** tab, set the width and the height (rows) of the card.
6. Click **Save**.

Replacing Home Assistant's calendar card? Change `type: calendar` into
`type: custom:calendar-card-with-avatars` in its YAML; your calendars carry
over.

## Options in YAML

Everything is in the visual editor; this is for those who prefer YAML.

```yaml
type: custom:calendar-card-with-avatars
title: Family            # optional
days: 7                  # days to show, 1 to 31
calendars:
  - entity: calendar.family
  - entity: calendar.work
    person: person.alice # Alice's picture in front of every event
  - entity: calendar.school
    color: green
    picture:             # an uploaded picture (the editor fills this in)
      media_content_id: media-source://image_upload/0123456789abcdef
      media_content_type: image/png
name_pictures: true      # [Name] in titles becomes the person's picture
waste_pictures: true     # Afvalbeheer collections show the waste type picture
picture_rules:
  - text: football
    entity: person.bob   # or picture: an uploaded picture
grid_options:
  columns: full
  rows: 8
```

Heights that depend on a condition (leave `rows` out of `grid_options`, a
height in the Layout tab always wins):

```yaml
type: custom:calendar-card-with-avatars
calendars:
  - entity: calendar.family
grid_options:
  columns: full
rows: 9                  # the default height
heights:                 # the first one that applies is used
  - rows: 7              # several conditions: all must be met
    conditions:          # (the format of the card visibility conditions)
      - condition: state
        entity: input_boolean.guests
        state: "on"
      - condition: state
        entity: binary_sensor.warning
        state: "on"
  - rows: 8              # short form: one entity
    entity: binary_sensor.warning
    state: "on"          # or state_not: "off"
```

Supported conditions: `state` (`state`, `state_not`), `numeric_state`
(`above`, `below`), `screen` (`media_query`), `user` (`users`), and `and`,
`or`, `not` around other conditions.

## How the waste pictures are found

Afvalbeheer's calendar events carry only the name of the waste type (which you
may have renamed), while its sensors carry the pictures. The card links them
by the waste type in the sensor name (`GFT` in "GFT collection") or
else by date: the sensor's next collection is the day of the event. Once
linked, later collections of the same type get the same picture. A picture
rule always wins, so you can set any picture yourself.

## License

MIT, see [LICENSE](LICENSE).
