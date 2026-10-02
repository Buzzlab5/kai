/**
 * Dates the way a person says them: "Monday 28 June 2027" and "at 1:30 PM", never "2027-06-28".
 * Relative words the traveller used ("tomorrow", "tonight") are kept as they are. The weekday is
 * worked out from the calendar date itself (UTC), so it never shifts with the server's timezone.
 */
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];
const relativeDays = ["today", "tomorrow", "tonight"];

export function friendlyDate(isoDate: string) {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return isoDate;

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const weekday = weekdays[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];

  return `${weekday} ${day} ${months[month - 1]} ${year}`;
}

/** "tomorrow" or "Monday 28 June 2027", for the start of a sentence like "For ..., you can choose from". */
export function formatDateForSentence(dateText: string) {
  return relativeDays.includes(dateText.toLowerCase()) ? dateText : friendlyDate(dateText);
}

/** "tomorrow", "on Monday 28 June 2027", or "that date" when there isn't one. */
export function formatDatePhrase(dateText: string | null): string {
  if (!dateText) return "that date";
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dateText)) return formatDateAndTime(dateText);

  return relativeDays.includes(dateText.toLowerCase()) ? dateText : `on ${friendlyDate(dateText)}`;
}

/** "on Monday 28 June 2027 at 1:30 PM" for a booking system's "2027-06-28 13:30:00". */
export function formatDateAndTime(dateText: string | null): string {
  if (!dateText) return "that date";

  const match = dateText.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):\d{2}$/);
  if (!match) return formatDatePhrase(dateText);

  const hour24 = Number(match[2]);
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;

  return `on ${friendlyDate(match[1])} at ${hour12}:${match[3]} ${period}`;
}
