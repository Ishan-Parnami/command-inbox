"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Calendar } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useContactSuggestions, applyContactToken } from "@/hooks/useContactSuggestions";

export type EventSeed = {
  title?: string;
  description?: string;
  location?: string;
  startTime?: string; // ISO or datetime-local value
  endTime?: string;
  attendees?: string;
};

// Format a Date to the value datetime-local expects: "YYYY-MM-DDTHH:mm"
function toLocal(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultStart() {
  const d = new Date();
  d.setMinutes(Math.ceil(d.getMinutes() / 30) * 30, 0, 0);
  return toLocal(d);
}

function defaultEnd(start: string) {
  const d = new Date(start);
  d.setHours(d.getHours() + 1);
  return toLocal(d);
}

export function CreateEventModal({
  open,
  seed,
  eventId,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  seed: EventSeed;
  eventId?: string; // when set, the modal edits (reschedules) an existing event
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}) {
  const isEdit = !!eventId;
  const start0 = seed.startTime ? toLocal(new Date(seed.startTime)) : defaultStart();
  const [title, setTitle] = useState(seed.title ?? "");
  const [description, setDescription] = useState(seed.description ?? "");
  const [startTime, setStartTime] = useState(start0);
  const [endTime, setEndTime] = useState(seed.endTime ? toLocal(new Date(seed.endTime)) : defaultEnd(start0));
  const [location, setLocation] = useState(seed.location ?? "");
  const [attendees, setAttendees] = useState(seed.attendees ?? "");
  const [saving, setSaving] = useState(false);
  const [conflicts, setConflicts] = useState<{ title: string; startTime: string }[]>([]);
  const [attendeesFocused, setAttendeesFocused] = useState(false);
  const attendeeSuggestions = useContactSuggestions(attendees);

  const save = async (force = false) => {
    if (!title.trim()) { toast.error("Title is required"); return; }
    setSaving(true);
    setConflicts([]);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        location: location.trim() || undefined,
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        attendees: attendees.split(",").map((e) => e.trim()).filter(Boolean),
      };
      const res = isEdit
        ? await fetch(`/api/events/${eventId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, force }),
          })
        : await fetch("/api/events/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, force }),
          });
      const data = await res.json();
      if (res.status === 409 && data.conflicts) {
        setConflicts(data.conflicts);
        setSaving(false);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "failed");
      toast(isEdit ? "Event updated" : "Event created");
      onOpenChange(false);
      onCreated?.();
    } catch {
      toast.error(isEdit ? "Failed to update event" : "Failed to create event");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="size-4" />
            {isEdit ? "Reschedule event" : "New event"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            autoFocus
          />

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Start</label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => {
                  setStartTime(e.target.value);
                  if (new Date(e.target.value) >= new Date(endTime))
                    setEndTime(defaultEnd(e.target.value));
                }}
                className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">End</label>
              <input
                type="datetime-local"
                value={endTime}
                min={startTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
              />
            </div>
          </div>

          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Location (optional)"
          />

          <div className="relative">
            <Input
              value={attendees}
              onChange={(e) => setAttendees(e.target.value)}
              onFocus={() => setAttendeesFocused(true)}
              onBlur={() => setAttendeesFocused(false)}
              placeholder="Attendees — comma-separated emails"
            />
            {attendeesFocused && attendeeSuggestions.suggestions.length > 0 && (
              <ul className="absolute left-0 right-0 top-full z-50 mt-0.5 max-h-48 overflow-auto rounded-md border bg-popover py-1 shadow-md">
                {attendeeSuggestions.suggestions.map((c) => (
                  <li key={c.email}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setAttendees(applyContactToken(attendees, c.email));
                      }}
                      className="flex w-full flex-col items-start px-3 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      <span className="font-medium">{c.name || c.email}</span>
                      {c.name && <span className="text-xs text-muted-foreground">{c.email}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            className="resize-none"
            rows={3}
          />

          {conflicts.length > 0 && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
              <p className="mb-1.5 font-medium text-destructive">Scheduling conflict</p>
              {conflicts.map((c) => (
                <p key={c.startTime} className="text-muted-foreground">
                  {c.title} — {format(new Date(c.startTime), "MMM d, h:mm a")}
                </p>
              ))}
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => save(true)}
                disabled={saving}
              >
                Create anyway
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save()} disabled={saving || !title.trim()}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create event"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
