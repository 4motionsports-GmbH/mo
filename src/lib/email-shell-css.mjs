// The <style> block of the branded mail shells — classic (email-template.ts)
// and block templates (mail-template-render.mjs) — so the media rules every
// shared building block relies on (product rows and grid, the set frame,
// the content padding on phones) exist exactly once. Progressive
// enhancement only: every critical style is inline. Pure .mjs so the pure
// template renderer and the TypeScript shell share it byte for byte.

/** The CSS inside <style type="text/css"> (indented for the shell's <head>). */
export const EMAIL_SHELL_CSS = `      /* Progressive enhancement ONLY — every critical style is inline. */
      html, body { Margin: 0 auto !important; padding: 0 !important; width: 100% !important; }
      * { -ms-text-size-adjust: 100%; -webkit-text-size-adjust: 100%; }
      table, th, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
      table { border-spacing: 0 !important; border-collapse: collapse !important; border: none; Margin: 0 auto; }
      img { -ms-interpolation-mode: bicubic; border: none !important; outline: none !important; text-decoration: none !important; }
      .grid-column { max-width: 50%; }
      @media only screen and (max-width:480px) {
        .email-container { width: 100% !important; min-width: 100% !important; }
        .content-pad { padding-right: 15px !important; padding-left: 15px !important; }
        .grid-tile { width: 100% !important; max-width: 100% !important; }
        .grid-image { width: 100% !important; height: auto !important; }
        /* Product ROWS keep image-left | text-right on phones — the image
           just shrinks into its third so rows stay one symmetric block. */
        .prow-image { width: 100% !important; height: auto !important; }
        /* The set frame (bundle-email.ts): eyecatcher text and badge stack
           centred; each item row keeps a smaller picture on the left and
           stacks name and price beside it. */
        .set-eye-text, .set-eye-badge, .set-item-text, .set-item-price { display: block !important; width: 100% !important; box-sizing: border-box !important; }
        .set-eye-text { padding: 0 !important; }
        .set-eye-text p { text-align: center !important; }
        .set-eye-badge { padding-top: 14px !important; }
        .set-badge { float: none !important; margin: 0 auto !important; }
        .set-item-img { width: 64px !important; height: 64px !important; }
        .set-item-img-cell { width: 74px !important; padding-right: 10px !important; }
        .set-item-text { padding: 14px 0 4px 0 !important; }
        .set-item-price { padding: 0 0 14px 0 !important; }
        .set-item-price p { text-align: left !important; }
      }`;
