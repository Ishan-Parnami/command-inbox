export type Attendee = {
  email: string;
  name: string | null;
  rsvpStatus: string;
  isOrganizer: boolean;
};

export type CalEvent = {
  id: string;
  title: string | null;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  meetingLink: string | null;
  location: string | null;
  description: string | null;
  status: string;
  aiBrief: string | null;
  attendees: Attendee[];
};

export type CalendarViewMode = "day" | "week" | "month";
