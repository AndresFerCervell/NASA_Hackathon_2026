import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { computeJulianDate, daysInMonth, jdToCalendarUTC } from '../astronomy/ephemeris';

interface DateTimeControlBarProps {
  year: number;
  month: number;
  day: number;
  hour: number;
  onChangeUTC: (year: number, month: number, day: number, hour: number) => void;
}

interface TimezoneOption {
  id: string;
  label: string;
  shortLabel: string;
  offsetMinutes: number;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function buildTimezoneOptions(): TimezoneOption[] {
  const options: TimezoneOption[] = [];
  for (let offsetHr = -12; offsetHr <= 14; offsetHr += 1) {
    const label =
      offsetHr === 0 ? 'UTC' : offsetHr > 0 ? `UTC+${offsetHr}` : `UTC${offsetHr}`;
    options.push({
      id: label.toLowerCase(),
      label,
      shortLabel: label,
      offsetMinutes: offsetHr * 60,
    });
  }
  return options;
}

function parseDateOnly(raw: string) {
  const match = raw.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return null;

  const y = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const d = parseInt(match[3], 10);
  if (y < 1900 || y > 2100) return null;
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > daysInMonth(y, m)) return null;
  return { year: y, month: m, day: d };
}

function parseTimeOnly(raw: string) {
  const match = raw.trim().match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) return null;

  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { hours: h, minutes: m };
}

export function DateTimeControlBar({
  year,
  month,
  day,
  hour,
  onChangeUTC,
}: DateTimeControlBarProps) {
  const timezoneOptions = useMemo(() => buildTimezoneOptions(), []);
  const [selectedTzId, setSelectedTzId] = useState<string>('utc');
  const activeTz = useMemo(
    () => timezoneOptions.find((tz) => tz.id === selectedTzId) ?? timezoneOptions[0],
    [timezoneOptions, selectedTzId]
  );

  // Convert incoming UTC calendar to the selected display timezone
  const localCal = useMemo(() => {
    const utcJD = computeJulianDate(year, month, day, hour);
    const localJD = utcJD + activeTz.offsetMinutes / 1440;
    const raw = jdToCalendarUTC(localJD);
    let totalMins = Math.round(raw.hour * 60);
    if (totalMins >= 1440) {
      const rolled = jdToCalendarUTC(computeJulianDate(raw.year, raw.month, raw.day, 24));
      totalMins = 0;
      return {
        year: rolled.year,
        month: rolled.month,
        day: rolled.day,
        totalMinutes: totalMins,
        hours: 0,
        minutes: 0,
      };
    }
    if (totalMins < 0) totalMins = 0;
    return {
      year: raw.year,
      month: raw.month,
      day: raw.day,
      totalMinutes: totalMins,
      hours: Math.floor(totalMins / 60),
      minutes: totalMins % 60,
    };
  }, [year, month, day, hour, activeTz.offsetMinutes]);

  const maxDays = useMemo(
    () => daysInMonth(localCal.year, localCal.month),
    [localCal.year, localCal.month]
  );
  const clampedDay = Math.min(localCal.day, maxDays);

  const formattedDate = `${String(localCal.year).padStart(4, '0')}-${pad2(localCal.month)}-${pad2(clampedDay)}`;
  const formattedTime = `${pad2(localCal.hours)}:${pad2(localCal.minutes)}`;

  const [focusedField, setFocusedField] = useState<'date' | 'time' | null>(null);
  const [dateDraft, setDateDraft] = useState(formattedDate);
  const [timeDraft, setTimeDraft] = useState(formattedTime);
  const [dateError, setDateError] = useState<string | null>(null);
  const [timeError, setTimeError] = useState<string | null>(null);

  const [calendarOpen, setCalendarOpen] = useState(false);
  const [viewYear, setViewYear] = useState(localCal.year);
  const [viewMonth, setViewMonth] = useState(localCal.month);
  const calendarWrapRef = useRef<HTMLDivElement | null>(null);

  const emitLocalChange = (ly: number, lm: number, ld: number, lHour: number) => {
    const safeDay = Math.min(ld, daysInMonth(ly, lm));
    const localJD = computeJulianDate(ly, lm, safeDay, lHour);
    const utcJD = localJD - activeTz.offsetMinutes / 1440;
    const utcCal = jdToCalendarUTC(utcJD);
    onChangeUTC(utcCal.year, utcCal.month, utcCal.day, utcCal.hour);
  };

  // Sync displayed text whenever external date/time or timezone changes
  useEffect(() => {
    if (focusedField !== 'date') {
      setDateDraft(formattedDate);
      setDateError(null);
    }
  }, [formattedDate, focusedField]);

  useEffect(() => {
    if (focusedField !== 'time') {
      setTimeDraft(formattedTime);
      setTimeError(null);
    }
  }, [formattedTime, focusedField]);

  useEffect(() => {
    if (!calendarOpen) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (calendarWrapRef.current && !calendarWrapRef.current.contains(e.target as Node)) {
        setCalendarOpen(false);
      }
    };
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCalendarOpen(false);
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [calendarOpen]);

  const handleToggleCalendar = () => {
    setCalendarOpen((prev) => {
      const next = !prev;
      if (next) {
        // Initialize calendar view to the currently selected date in the active timezone
        setViewYear(localCal.year);
        setViewMonth(localCal.month);
      }
      return next;
    });
  };

  const shiftMonth = (delta: number) => {
    let nextMonth = viewMonth + delta;
    let nextYear = viewYear;
    if (nextMonth < 1) {
      nextMonth = 12;
      nextYear = Math.max(1900, nextYear - 1);
    } else if (nextMonth > 12) {
      nextMonth = 1;
      nextYear = Math.min(2100, nextYear + 1);
    }
    setViewYear(nextYear);
    setViewMonth(nextMonth);
  };

  const calendarCells = useMemo(() => {
    const firstWeekday = (new Date(Date.UTC(viewYear, viewMonth - 1, 1)).getUTCDay() + 6) % 7;
    const total = daysInMonth(viewYear, viewMonth);
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
    for (let d = 1; d <= total; d += 1) cells.push(d);
    return cells;
  }, [viewYear, viewMonth]);

  const handleDateInputChange = (val: string) => {
    setDateDraft(val);
    setDateError(null);
    const parsed = parseDateOnly(val);
    if (parsed) {
      emitLocalChange(parsed.year, parsed.month, parsed.day, localCal.totalMinutes / 60);
    }
  };

  const commitDateInput = () => {
    const parsed = parseDateOnly(dateDraft);
    if (parsed) {
      emitLocalChange(parsed.year, parsed.month, parsed.day, localCal.totalMinutes / 60);
      setDateError(null);
      return true;
    }
    setDateError('Invalid date (1900–2100)');
    return false;
  };

  const handleTimeInputChange = (val: string) => {
    setTimeDraft(val);
    setTimeError(null);
    const parsed = parseTimeOnly(val);
    if (parsed) {
      emitLocalChange(localCal.year, localCal.month, clampedDay, parsed.hours + parsed.minutes / 60);
    }
  };

  const commitTimeInput = () => {
    const parsed = parseTimeOnly(timeDraft);
    if (parsed) {
      emitLocalChange(localCal.year, localCal.month, clampedDay, parsed.hours + parsed.minutes / 60);
      setTimeError(null);
      return true;
    }
    setTimeError('Invalid time (00:00–23:59)');
    return false;
  };

  const handleFieldKeyDown = (
    e: KeyboardEvent<HTMLInputElement>,
    commitFn: () => boolean
  ) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (commitFn()) {
        setFocusedField(null);
        e.currentTarget.blur();
      }
    }
  };

  return (
    <div className="date-controls-row">
      {/* Date Input + Calendar Trigger */}
      <div className="control-cell datetime-picker-cell" ref={calendarWrapRef}>
        <div className="control-top">
          <label htmlFor="ctrl-date">Date</label>
          {dateError && (
            <span id="ctrl-date-err" className="datetime-error" role="status">
              {dateError}
            </span>
          )}
        </div>

        <div className="datetime-input-group">
          <div className="datetime-field-wrap">
            <div className="input-ghost-overlay" aria-hidden="true">
              <span className="ghost-typed">
                {focusedField === 'date' || dateError ? dateDraft : formattedDate}
              </span>
              <span className="ghost-rest">
                {'YYYY-MM-DD'.slice(
                  (focusedField === 'date' || dateError ? dateDraft : formattedDate).length
                )}
              </span>
            </div>
            <input
              id="ctrl-date"
              name="dateValue"
              type="text"
              className="datetime-text-input"
              value={focusedField === 'date' || dateError ? dateDraft : formattedDate}
              inputMode="numeric"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="next"
              aria-invalid={dateError !== null}
              aria-describedby={dateError ? 'ctrl-date-err ctrl-date-hint' : 'ctrl-date-hint'}
              onFocus={() => {
                setFocusedField('date');
                if (!dateError) setDateDraft(formattedDate);
              }}
              onChange={(e) => handleDateInputChange(e.target.value)}
              onBlur={() => {
                setFocusedField((prev) => (prev === 'date' ? null : prev));
                commitDateInput();
              }}
              onKeyDown={(e) => handleFieldKeyDown(e, commitDateInput)}
            />
          </div>

          <button
            type="button"
            className={`hud-btn calendar-trigger-btn ${calendarOpen ? 'is-active' : ''}`}
            aria-label="Open calendar and time picker"
            aria-expanded={calendarOpen}
            aria-haspopup="dialog"
            title="Select date and time from calendar"
            onClick={handleToggleCalendar}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </button>
        </div>

        <span id="ctrl-date-hint" className="control-hint">
          Format: YYYY-MM-DD
        </span>

        {calendarOpen && (
          <div
            className="hud-card calendar-popover"
            role="dialog"
            aria-label="Select date and time"
          >
            <div className="calendar-nav">
              <button
                type="button"
                className="hud-btn calendar-nav-btn"
                aria-label="Previous month"
                onClick={() => shiftMonth(-1)}
              >
                ‹
              </button>

              <div className="calendar-month-year">
                <select
                  aria-label="Month"
                  value={viewMonth}
                  onChange={(e) => setViewMonth(parseInt(e.target.value, 10))}
                >
                  {MONTH_NAMES.map((name, idx) => (
                    <option key={name} value={idx + 1}>
                      {name}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="Year"
                  type="number"
                  min={1900}
                  max={2100}
                  value={viewYear}
                  onChange={(e) => {
                    const y = parseInt(e.target.value, 10);
                    if (!Number.isNaN(y)) {
                      setViewYear(Math.max(1900, Math.min(2100, y)));
                    }
                  }}
                />
              </div>

              <button
                type="button"
                className="hud-btn calendar-nav-btn"
                aria-label="Next month"
                onClick={() => shiftMonth(1)}
              >
                ›
              </button>
            </div>

            <div className="calendar-weekdays" aria-hidden="true">
              {WEEKDAYS.map((wd) => (
                <span key={wd}>{wd}</span>
              ))}
            </div>

            <div className="calendar-days-grid">
              {calendarCells.map((cellDay, idx) => {
                if (cellDay === null) {
                  return <span key={`empty-${idx}`} className="calendar-day-empty" />;
                }
                const isSelected =
                  viewYear === localCal.year && viewMonth === localCal.month && cellDay === clampedDay;
                return (
                  <button
                    key={cellDay}
                    type="button"
                    className={`calendar-day-btn ${isSelected ? 'is-selected' : ''}`}
                    aria-pressed={isSelected}
                    onClick={() => {
                      setDateError(null);
                      setTimeError(null);
                      emitLocalChange(viewYear, viewMonth, cellDay, localCal.totalMinutes / 60);
                    }}
                  >
                    {cellDay}
                  </button>
                );
              })}
            </div>

            <div className="calendar-time-row">
              <div className="calendar-time-fields">
                <label htmlFor="cal-time-hr">Time</label>
                <div className="calendar-time-inputs">
                  <input
                    id="cal-time-hr"
                    aria-label="Hours"
                    type="number"
                    min={0}
                    max={23}
                    value={localCal.hours}
                    onChange={(e) => {
                      const rawH = parseInt(e.target.value, 10);
                      if (Number.isNaN(rawH)) return;
                      const h = Math.max(0, Math.min(23, rawH));
                      setTimeError(null);
                      emitLocalChange(
                        localCal.year,
                        localCal.month,
                        clampedDay,
                        h + localCal.minutes / 60
                      );
                    }}
                  />
                  <span>:</span>
                  <input
                    id="cal-time-min"
                    aria-label="Minutes"
                    type="number"
                    min={0}
                    max={59}
                    value={localCal.minutes}
                    onChange={(e) => {
                      const rawM = parseInt(e.target.value, 10);
                      if (Number.isNaN(rawM)) return;
                      const m = Math.max(0, Math.min(59, rawM));
                      setTimeError(null);
                      emitLocalChange(
                        localCal.year,
                        localCal.month,
                        clampedDay,
                        localCal.hours + m / 60
                      );
                    }}
                  />
                  <select
                    aria-label="Calendar timezone"
                    className="calendar-tz-select"
                    value={selectedTzId}
                    onChange={(e) => {
                      setFocusedField(null);
                      setDateError(null);
                      setTimeError(null);
                      setSelectedTzId(e.target.value);
                    }}
                  >
                    {timezoneOptions.map((tz) => (
                      <option key={tz.id} value={tz.id}>
                        {tz.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <button
                type="button"
                className="hud-btn is-active"
                onClick={() => setCalendarOpen(false)}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Time Input */}
      <div className="control-cell">
        <div className="control-top">
          <label htmlFor="ctrl-time">Time</label>
          {timeError && (
            <span id="ctrl-time-err" className="datetime-error" role="status">
              {timeError}
            </span>
          )}
        </div>

        <div className="datetime-field-wrap">
          <div className="input-ghost-overlay" aria-hidden="true">
            <span className="ghost-typed">
              {focusedField === 'time' || timeError ? timeDraft : formattedTime}
            </span>
            <span className="ghost-rest">
              {'HH:MM'.slice(
                (focusedField === 'time' || timeError ? timeDraft : formattedTime).length
              )}
            </span>
          </div>
          <input
            id="ctrl-time"
            name="timeValue"
            type="text"
            className="datetime-text-input"
            value={focusedField === 'time' || timeError ? timeDraft : formattedTime}
            inputMode="numeric"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="done"
            aria-invalid={timeError !== null}
            aria-describedby={timeError ? 'ctrl-time-err ctrl-time-hint' : 'ctrl-time-hint'}
            onFocus={() => {
              setFocusedField('time');
              if (!timeError) setTimeDraft(formattedTime);
            }}
            onChange={(e) => handleTimeInputChange(e.target.value)}
            onBlur={() => {
              setFocusedField((prev) => (prev === 'time' ? null : prev));
              commitTimeInput();
            }}
            onKeyDown={(e) => handleFieldKeyDown(e, commitTimeInput)}
          />
        </div>

        <span id="ctrl-time-hint" className="control-hint">
          Format: HH:MM (24h)
        </span>
      </div>

      {/* Timezone Selector */}
      <div className="control-cell">
        <div className="control-top">
          <label htmlFor="ctrl-timezone">Timezone</label>
          <span className="control-val">{activeTz.shortLabel}</span>
        </div>

        <select
          id="ctrl-timezone"
          name="timezone"
          value={selectedTzId}
          onChange={(e) => {
            setFocusedField(null);
            setDateError(null);
            setTimeError(null);
            setSelectedTzId(e.target.value);
          }}
        >
          {timezoneOptions.map((tz) => (
            <option key={tz.id} value={tz.id}>
              {tz.label}
            </option>
          ))}
        </select>

        <span className="control-hint">Active: {activeTz.shortLabel}</span>
      </div>
    </div>
  );
}
