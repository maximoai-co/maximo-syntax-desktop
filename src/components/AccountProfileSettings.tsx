import { useEffect, useRef, useState } from "react";
import { Camera, ImageOff, LoaderCircle, Save, UserRound } from "lucide-react";
import type { AccountProfile, AccountStatus } from "../../desktop/types";
import UserAvatar from "./UserAvatar";

const emptyProfile = (account: AccountStatus | null): AccountProfile => ({
  provider: account?.profileEditable ? (account.authMethod === "mytabulon" ? "mytabulon" : "maximoai") : "local",
  editable: Boolean(account?.profileEditable),
  email: account?.email,
  displayName: account?.displayName,
  username: account?.username,
  photoUrl: account?.photoUrl,
});

export default function AccountProfileSettings({
  account,
  onAccountChanged,
}: {
  account: AccountStatus | null;
  onAccountChanged: (status: AccountStatus) => void;
}) {
  const [profile, setProfile] = useState<AccountProfile>(() => emptyProfile(account));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void window.maximoDesktop.accountProfile().then((next) => {
      if (cancelled) return;
      setProfile(next);
      setLoading(false);
    }).catch((caught: unknown) => {
      if (cancelled) return;
      setProfile(emptyProfile(account));
      setError(caught instanceof Error ? caught.message : "Could not load your profile.");
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [account?.authMethod, account?.email, account?.photoUrl]);

  const applyResult = (result: { ok: boolean; message: string; profile: AccountProfile; status: AccountStatus }) => {
    setProfile(result.profile);
    onAccountChanged(result.status);
    if (result.ok) {
      setError(null);
      setStatus(result.message);
    } else {
      setStatus(null);
      setError(result.message);
    }
  };

  const save = async () => {
    if (!profile.editable) return;
    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      const result = await window.maximoDesktop.accountUpdateProfile({
        username: profile.username ?? "",
        displayName: profile.displayName ?? "",
        firstName: profile.firstName,
        lastName: profile.lastName,
        phone: profile.phone ?? "",
        bio: profile.bio ?? "",
        twitterUsername: profile.twitterUsername ?? "",
        telegramUsername: profile.telegramUsername ?? "",
        socialLinkedin: profile.socialLinkedin ?? "",
        socialTwitter: profile.socialTwitter ?? "",
        socialFacebook: profile.socialFacebook ?? "",
        socialInstagram: profile.socialInstagram ?? "",
        socialYoutube: profile.socialYoutube ?? "",
        socialTiktok: profile.socialTiktok ?? "",
      });
      applyResult(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  };

  const uploadPhoto = async (file: File | undefined) => {
    if (!file || !profile.editable) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose a JPEG, PNG, GIF, or WebP image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Profile photos must be 5 MB or smaller.");
      return;
    }
    setPhotoBusy(true);
    setStatus(null);
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await window.maximoDesktop.accountUploadPhoto(file.name, file.type, bytes);
      applyResult(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update your profile photo.");
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removePhoto = async () => {
    if (!profile.editable || !profile.photoUrl) return;
    setPhotoBusy(true);
    setStatus(null);
    setError(null);
    try {
      applyResult(await window.maximoDesktop.accountDeletePhoto());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove your profile photo.");
    } finally {
      setPhotoBusy(false);
    }
  };

  const update = <Key extends keyof AccountProfile>(key: Key, value: AccountProfile[Key]) => {
    setProfile((current) => ({ ...current, [key]: value }));
  };

  const name = profile.displayName || profile.username || account?.displayName || account?.email || "Account";
  const providerLabel = profile.provider === "mytabulon" ? "MyTabulon" : profile.provider === "maximoai" ? "Maximo AI" : "This computer";

  return (
    <div className="settings-panel-stack account-profile-settings">
      <section className="settings-card account-profile-hero">
        <div className="account-profile-hero-copy">
          <span className="eyebrow">{providerLabel}</span>
          <h2>Account profile</h2>
          <p>Your photo, name, and username appear in the sidebar and follow you across Maximo Syntax on this computer.</p>
        </div>
        <div className="account-profile-photo">
          <UserAvatar url={profile.photoUrl} name={name} size={88} className="account-profile-photo-mark" />
          {profile.editable && (
            <div className="account-profile-photo-actions">
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" hidden onChange={(event) => void uploadPhoto(event.target.files?.[0])} />
              <button type="button" className="settings-action" disabled={photoBusy} onClick={() => fileRef.current?.click()}>
                {photoBusy ? <LoaderCircle size={13} className="spin" /> : <Camera size={13} />}
                {profile.photoUrl ? "Change photo" : "Add photo"}
              </button>
              {profile.photoUrl && (
                <button type="button" className="settings-action danger" disabled={photoBusy} onClick={() => void removePhoto()}>
                  <ImageOff size={13} />Remove
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {!profile.editable && (
        <section className="settings-card">
          <div className="settings-account-row">
            <span className={`account-state ${account?.loggedIn ? "online" : ""}`}><UserRound size={16} /></span>
            <span>
              <strong>{account?.email || account?.displayName || "Not signed in"}</strong>
              <small>Profile editing is available when you sign in with Maximo AI or MyTabulon.</small>
            </span>
          </div>
        </section>
      )}

      <section className="settings-card">
        <h2>Identity</h2>
        <label className="settings-row">
          <span><strong>Full name</strong><small>Shown in the sidebar and on shared activity cards.</small></span>
          <input className="settings-text-control" value={profile.displayName ?? ""} disabled={!profile.editable || loading} onChange={(event) => update("displayName", event.target.value)} placeholder="Your name" />
        </label>
        <label className="settings-row">
          <span><strong>Username</strong><small>Letters, numbers, periods, underscores, and hyphens.</small></span>
          <span className="profile-edit-handle-input settings-handle-control"><b aria-hidden="true">@</b><input value={(profile.username ?? "").replace(/^@+/, "")} disabled={!profile.editable || loading} onChange={(event) => update("username", event.target.value.replace(/^@+/, "").replace(/\s+/g, ""))} placeholder="username" /></span>
        </label>
        <div className="settings-row">
          <span><strong>Email</strong><small>Managed by your Maximo AI or MyTabulon account.</small></span>
          <span className="setting-value">{profile.email || account?.email || "—"}</span>
        </div>
        {profile.provider === "mytabulon" && (
          <label className="settings-row">
            <span><strong>Phone</strong><small>Optional. Used across your MyTabulon workspace.</small></span>
            <input className="settings-text-control" value={profile.phone ?? ""} disabled={!profile.editable || loading} onChange={(event) => update("phone", event.target.value)} placeholder="+234…" />
          </label>
        )}
        <label className="settings-row settings-row-wide">
          <span><strong>Bio</strong><small>A short line about you. Optional.</small></span>
          <textarea className="settings-textarea-control" rows={3} maxLength={500} value={profile.bio ?? ""} disabled={!profile.editable || loading} onChange={(event) => update("bio", event.target.value)} placeholder="What you’re building" />
        </label>
      </section>

      {profile.editable && <section className="settings-card">
        <h2>Social</h2>
        <p>Optional public handles. These stay on your account and can be shown in workspace tools.</p>
        {profile.provider === "maximoai" ? (
          <>
            <label className="settings-row">
              <span><strong>X / Twitter</strong></span>
              <input className="settings-text-control" value={profile.twitterUsername ?? ""} disabled={!profile.editable || loading} onChange={(event) => update("twitterUsername", event.target.value.replace(/^@+/, ""))} placeholder="handle" />
            </label>
            <label className="settings-row">
              <span><strong>Telegram</strong></span>
              <input className="settings-text-control" value={profile.telegramUsername ?? ""} disabled={!profile.editable || loading} onChange={(event) => update("telegramUsername", event.target.value.replace(/^@+/, ""))} placeholder="handle" />
            </label>
          </>
        ) : (
          <>
            <label className="settings-row">
              <span><strong>LinkedIn</strong></span>
              <input className="settings-text-control" value={profile.socialLinkedin ?? ""} disabled={!profile.editable || loading} onChange={(event) => update("socialLinkedin", event.target.value)} placeholder="https://linkedin.com/in/…" />
            </label>
            <label className="settings-row">
              <span><strong>X / Twitter</strong></span>
              <input className="settings-text-control" value={profile.socialTwitter ?? profile.twitterUsername ?? ""} disabled={!profile.editable || loading} onChange={(event) => update("socialTwitter", event.target.value)} placeholder="https://x.com/…" />
            </label>
            <label className="settings-row">
              <span><strong>Instagram</strong></span>
              <input className="settings-text-control" value={profile.socialInstagram ?? ""} disabled={!profile.editable || loading} onChange={(event) => update("socialInstagram", event.target.value)} placeholder="https://instagram.com/…" />
            </label>
            <label className="settings-row">
              <span><strong>YouTube</strong></span>
              <input className="settings-text-control" value={profile.socialYoutube ?? ""} disabled={!profile.editable || loading} onChange={(event) => update("socialYoutube", event.target.value)} placeholder="https://youtube.com/…" />
            </label>
            <label className="settings-row">
              <span><strong>TikTok</strong></span>
              <input className="settings-text-control" value={profile.socialTiktok ?? ""} disabled={!profile.editable || loading} onChange={(event) => update("socialTiktok", event.target.value)} placeholder="https://tiktok.com/@…" />
            </label>
            <label className="settings-row">
              <span><strong>Facebook</strong></span>
              <input className="settings-text-control" value={profile.socialFacebook ?? ""} disabled={!profile.editable || loading} onChange={(event) => update("socialFacebook", event.target.value)} placeholder="https://facebook.com/…" />
            </label>
          </>
        )}
      </section>}

      {(status || error) && <p className={`settings-notification-status ${error ? "error" : ""}`} role="status">{error || status}</p>}
      {profile.editable && (
        <div className="account-profile-save-row">
          <button type="button" className="primary-button compact" disabled={saving || loading} onClick={() => void save()}>
            {saving ? <LoaderCircle size={13} className="spin" /> : <Save size={13} />}
            {saving ? "Saving…" : "Save profile"}
          </button>
        </div>
      )}
    </div>
  );
}
