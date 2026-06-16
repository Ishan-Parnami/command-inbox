"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Star, Users, Mail, Plus, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

type Contact = {
  id: string;
  email: string;
  name: string | null;
  isVip: boolean;
  emailCount: number;
  lastEmailedAt: string | null;
  avgReplyHours: number | null;
};

function initials(c: Contact) {
  if (c.name) {
    const parts = c.name.split(" ");
    return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return c.email[0].toUpperCase();
}

export function ContactsView() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ contacts: Contact[] }>({
    queryKey: ["contacts"],
    queryFn: () => fetch("/api/contacts").then((r) => r.json()),
    staleTime: 60_000,
  });

  const toggleVip = useMutation({
    mutationFn: ({ id, isVip }: { id: string; isVip: boolean }) =>
      fetch("/api/contacts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isVip }),
      }),
    onMutate: async ({ id, isVip }) => {
      await qc.cancelQueries({ queryKey: ["contacts"] });
      const prev = qc.getQueryData<{ contacts: Contact[] }>(["contacts"]);
      qc.setQueryData<{ contacts: Contact[] }>(["contacts"], (old) => ({
        contacts: (old?.contacts ?? []).map((c) => c.id === id ? { ...c, isVip } : c),
      }));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      qc.setQueryData(["contacts"], ctx?.prev);
      toast.error("Failed to update VIP status");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["contacts"] }),
  });

  const saveContact = useMutation({
    mutationFn: ({ id, email, name }: { id?: string; email?: string; name: string }) =>
      id
        ? fetch("/api/contacts", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, name }),
          })
        : fetch("/api/contacts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, name }),
          }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      setEditor(null);
      toast.success("Contact saved");
    },
    onError: () => toast.error("Failed to save contact"),
  });

  const deleteContact = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/contacts?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      toast.success("Contact deleted");
    },
    onError: () => toast.error("Failed to delete contact"),
  });

  const contacts = data?.contacts ?? [];
  const [filter, setFilter] = useState<"all" | "vip">("all");
  const visible = filter === "vip" ? contacts.filter((c) => c.isVip) : contacts;

  // editor: { id?, email, name } when adding/editing; null when closed.
  const [editor, setEditor] = useState<{ id?: string; email: string; name: string } | null>(null);
  const isEditing = !!editor?.id;
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Users className="size-4 text-primary" />
          Contacts
          {contacts.length > 0 && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
              {contacts.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {(["all", "vip"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                filter === f ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f === "vip" ? "VIP" : "All"}
            </button>
          ))}
          <Button size="sm" variant="outline" className="ml-1" onClick={() => setEditor({ email: "", name: "" })}>
            <Plus className="size-3.5" />
            Add
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">Loading…</div>
        ) : contacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center text-muted-foreground">
            <Users className="size-8 opacity-30" />
            <div>
              <p className="text-sm font-medium">No contacts yet</p>
              <p className="text-xs">Sync your inbox to populate contacts, or add one manually.</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setEditor({ email: "", name: "" })}>
              <Plus className="size-3.5" />
              Add contact
            </Button>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            No VIP contacts yet — star someone below.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background border-b">
              <tr className="text-xs text-muted-foreground">
                <th className="px-6 py-2 text-left font-medium">Name</th>
                <th className="px-4 py-2 text-center font-medium">Emails</th>
                <th className="px-4 py-2 text-left font-medium">Last seen</th>
                <th className="px-4 py-2 text-center font-medium">Avg reply</th>
                <th className="px-4 py-2 text-center font-medium">VIP</th>
                <th className="px-4 py-2 text-center font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr
                  key={c.id}
                  className="border-b transition-colors hover:bg-muted/40"
                >
                  {/* Avatar + name/email */}
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                        c.isVip
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground"
                      )}>
                        {initials(c)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">
                          {c.name ?? c.email}
                        </p>
                        {c.name && (
                          <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                            <Mail className="size-3" />
                            {c.email}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Email count */}
                  <td className="px-4 py-3 text-center">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                      {c.emailCount}
                    </span>
                  </td>

                  {/* Last emailed */}
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {c.lastEmailedAt
                      ? format(new Date(c.lastEmailedAt), "MMM d, yyyy")
                      : "—"}
                  </td>

                  {/* Avg reply hours */}
                  <td className="px-4 py-3 text-center text-xs text-muted-foreground">
                    {c.avgReplyHours != null
                      ? `${Math.round(c.avgReplyHours)}h`
                      : "—"}
                  </td>

                  {/* VIP toggle */}
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => toggleVip.mutate({ id: c.id, isVip: !c.isVip })}
                      title={c.isVip ? "Remove VIP" : "Mark as VIP"}
                      className="transition-colors"
                    >
                      <Star
                        className={cn(
                          "size-4",
                          c.isVip
                            ? "fill-amber-400 text-amber-400"
                            : "text-muted-foreground hover:text-amber-400"
                        )}
                      />
                    </button>
                  </td>

                  {/* Edit / delete */}
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => setEditor({ id: c.id, email: c.email, name: c.name ?? "" })}
                        title="Edit name"
                        className="text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(c)}
                        title="Delete contact"
                        className="text-muted-foreground transition-colors hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add / edit dialog */}
      <Dialog open={!!editor} onOpenChange={(o) => !o && setEditor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit contact" : "Add contact"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Email</label>
              <Input
                type="email"
                placeholder="name@example.com"
                value={editor?.email ?? ""}
                disabled={isEditing}
                onChange={(e) => setEditor((ed) => (ed ? { ...ed, email: e.target.value } : ed))}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Name</label>
              <Input
                placeholder="Full name"
                value={editor?.name ?? ""}
                onChange={(e) => setEditor((ed) => (ed ? { ...ed, name: e.target.value } : ed))}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              disabled={saveContact.isPending || (!isEditing && !editor?.email.trim())}
              onClick={() =>
                editor &&
                saveContact.mutate({ id: editor.id, email: editor.email.trim(), name: editor.name })
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete contact?</DialogTitle>
            <DialogDescription>
              {deleteTarget?.name ?? deleteTarget?.email} will be removed from your contacts. This can’t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleteContact.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteContact.isPending}
              onClick={() => {
                if (!deleteTarget) return;
                deleteContact.mutate(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
