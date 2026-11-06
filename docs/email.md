# Authentication email

Enable authentication email when users need invitations or password reset links delivered to their inboxes.
Sending requires Workers Paid and a domain registered with Cloudflare Email Sending. You can share copied invitation links without configuring email.

## Configure sending

Bind Email Sending in `wrangler.jsonc` and set the sending address and public URL in the deployment environment.
For named environments, put the binding and variables in the environment you deploy.

```jsonc
{
  "send_email": [
    {
      "name": "EMAIL_SENDER",
      "allowed_sender_addresses": ["no-reply@example.com"]
    }
  ],
  "vars": {
    "AUTH_EMAIL_FROM": "no-reply@example.com",
    "AUTH_EMAIL_BASE_URL": "https://cms.example.com"
  }
}
```

Use the same sender in `AUTH_EMAIL_FROM` and `allowed_sender_addresses`. Set `AUTH_EMAIL_BASE_URL` to the HTTPS origin where recipients will open the links, without a path.
For local development, an HTTP origin on localhost is allowed.

## Enable email in the Admin UI

After deploying the binding, sign in as a Super Admin and open **Settings → Email**. Save a sender display name, then enable invitations, password resets, or both. Each starts disabled.
The sending address and public origin come from the deployment settings.

Send a test from the same page. It uses the saved settings and goes to the signed-in administrator.
A successful result means Cloudflare accepted the message. Check that it arrives in your inbox.
Then invite a test email address or request a reset for a test account. Open the link to verify the public URL.
The latest result records the purpose, status, time, and error code, without the body, recipient, or token.

## Send invitations

Choose to send email when creating an invitation. If sending fails, open the invitation list to resend or copy the same link.
The link remains usable while the invitation is active, unused, and unexpired.

After changing `JWT_SECRET`, or if an existing invitation lacks the data for resending, regenerate its link before sending. Regeneration invalidates the old link.
See [invitation rules](./security.md#invitations) for who can receive an invitation.

## Reset a password

When password resets are enabled, the sign-in screen offers a reset link. The account owner follows the link within one hour of its issue to set a password, including for an existing account that has no password.
A request returns the same result whether the account exists or the sending service accepts the email.

Requesting another email leaves existing links valid until expiration. Disabling new requests also leaves previously issued links usable until they expire.
A successful reset invalidates all reset links and sessions for that user. Sign in again with the new password.
For request formats, see [Admin API authentication email](./api/admin.md#authentication-email).
