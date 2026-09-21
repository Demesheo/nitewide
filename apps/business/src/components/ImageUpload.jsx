import { useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, mediaSrc } from "@/lib/api";
export function ImageUpload({ value, session, onChange, onBusy }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function upload(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      setError("Choose a JPG, PNG, or WebP image up to 10 MB.");
      return;
    }
    setBusy(true);
    onBusy(true);
    try {
      const body = new FormData();
      body.append("image", file);
      const image = await api("/business/uploads/image", session, {
        method: "POST",
        body,
      });
      onChange(image);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <section className="image-upload" aria-label="Event artwork">
      <div className="upload-preview">
        {value ? (
          <img src={mediaSrc(value)} alt="Event flyer preview" />
        ) : (
          <ImagePlus size={30} />
        )}
      </div>
      <div className="upload-controls">
        <label className="field" htmlFor="event-image">
          <span>Event image or flyer</span>
          <Input
            id="event-image"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={upload}
          />
        </label>
        <p className="hint">
          JPG, PNG, or WebP · up to 10 MB · minimum 128 × 128. Portrait flyers
          stay uncropped on customer cards.
        </p>
        <p className="hint">
          Artwork URLs are public, even for drafts. Only upload images you have
          permission to publish—never private guest details.
        </p>
        {busy && <p role="status">Uploading and optimizing…</p>}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onChange(null)}
          >
            <Trash2 />
            Remove from event
          </Button>
        )}
      </div>
    </section>
  );
}
