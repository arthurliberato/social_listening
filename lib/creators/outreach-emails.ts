// The words of every outreach email. Creators get a link to their page, never an attachment or a login; brands get
// a short note with a link back to the campaign.
import { APP_URL } from "@/lib/email/service";

export const portalLink = (token: string) => `${APP_URL}/creator/${token}`;
const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
const footer = "\n\nThis message was sent through Ripplewise on behalf of the brand.";

export function invitationEmail(o: {
  brand: string;
  campaign: string;
  message: string;
  offeredUsd: number;
  token: string;
  expiresOn: string;
  revised: boolean;
}) {
  return {
    subject: o.revised
      ? `${o.brand} sent a new offer for "${o.campaign}"`
      : `${o.brand} would like to work with you: "${o.campaign}"`,
    text: `${o.message}\n\nOffer: ${usd(o.offeredUsd)} per post\nThis offer is open until ${o.expiresOn}.\n\nSee the brief and answer here:\n${portalLink(o.token)}${footer}`,
  };
}

export function creatorNotice(
  kind: "counter_accepted" | "counter_declined" | "changes" | "approved" | "paid",
  o: { brand: string; campaign: string; token: string; usd?: number; feedback?: string },
) {
  const link = `\n\nYour page:\n${portalLink(o.token)}${footer}`;
  switch (kind) {
    case "counter_accepted":
      return {
        subject: `${o.brand} accepted your proposal for "${o.campaign}"`,
        text: `Good news: ${o.brand} accepted your proposed fee of ${usd(o.usd ?? 0)}. You're confirmed for "${o.campaign}". You can submit your content from your page when it's ready.${link}`,
      };
    case "counter_declined":
      return {
        subject: `${o.brand} can't go ahead with "${o.campaign}"`,
        text: `Thanks for replying. ${o.brand} isn't able to go ahead with "${o.campaign}" on the terms discussed. We hope to work with you another time.${link}`,
      };
    case "changes":
      return {
        subject: `${o.brand} asked for changes to your content`,
        text: `${o.brand} reviewed your content for "${o.campaign}" and asked for changes:\n\n${o.feedback}\n\nYou can submit a new version from your page.${link}`,
      };
    case "approved":
      return {
        subject: `${o.brand} approved your content for "${o.campaign}"`,
        text: `${o.brand} approved your content. Payment of ${usd(o.usd ?? 0)} is next; you'll get another message when it's been sent.${link}`,
      };
    case "paid":
      return {
        subject: `Payment sent: ${usd(o.usd ?? 0)} for "${o.campaign}"`,
        text: `${o.brand} has marked your payment of ${usd(o.usd ?? 0)} for "${o.campaign}" as paid. Thank you!${link}`,
      };
  }
}

export function brandNotice(
  kind: "accepted" | "declined" | "countered" | "content",
  o: { creator: string; campaign: string; campaignUrl: string; usd?: number; note?: string },
) {
  const link = `\n\nOpen the campaign:\n${o.campaignUrl}`;
  switch (kind) {
    case "accepted":
      return {
        subject: `${o.creator} accepted "${o.campaign}"`,
        text: `${o.creator} accepted your offer of ${usd(o.usd ?? 0)} and is confirmed on "${o.campaign}".${link}`,
      };
    case "declined":
      return {
        subject: `${o.creator} declined "${o.campaign}"`,
        text: `${o.creator} declined your invitation to "${o.campaign}".${o.note ? `\n\nTheir note: ${o.note}` : ""}${link}`,
      };
    case "countered":
      return {
        subject: `${o.creator} proposed ${usd(o.usd ?? 0)} for "${o.campaign}"`,
        text: `${o.creator} replied with a different fee: ${usd(o.usd ?? 0)}.${o.note ? `\n\nTheir note: ${o.note}` : ""}\n\nYou can accept it, send a revised offer, or decline.${link}`,
      };
    case "content":
      return {
        subject: `${o.creator} submitted content for "${o.campaign}"`,
        text: `${o.creator} submitted content for review.${link}`,
      };
  }
}
