const recordings = [
  {
    id: 'r1',
    title: 'Invite fails silently when all seats are used',
    meta: 'Today · 2:34',
    modal: true,
    chips: ['Cut 2:10', 'Hindi dub'],
  },
  {
    id: 'r2',
    title: 'Billing page review',
    meta: 'Monday · 5:10',
    chips: ['Cut 3:40'],
  },
  {
    id: 'r3',
    title: 'Onboarding walkthrough',
    meta: '3 Nov · 8:42',
    chips: ['Vertical 0:45'],
  },
];
const moments = [
  {
    rec: 'r1',
    at: '01:06',
    text: 'Send invite clicked, dialog closes',
    kind: 'on screen',
    modal: true,
    words: 'invite send dialog closes',
  },
  {
    rec: 'r1',
    at: '02:10',
    text: '“…we’re out of seats, I think that’s why”',
    kind: 'spoken',
    words: 'seats out why',
  },
  {
    rec: 'r2',
    at: '03:02',
    text: '“we hit the seat limit again on staging”',
    kind: 'spoken',
    words: 'seat limit staging',
  },
  {
    rec: 'r2',
    at: '03:40',
    text: 'Upgrade plan dialog showing the seat count',
    kind: 'on screen',
    modal: true,
    words: 'upgrade plan seat count dialog',
  },
  {
    rec: 'r3',
    at: '07:11',
    text: '“seats are counted per workspace”',
    kind: 'spoken',
    words: 'seats counted workspace',
  },
];
const details = [
  {
    duration: 154,
    silence: 18,
    filler: 6,
    transcript:
      'So I’m going to invite Priya to the workspace. I’m in Team settings, on Members. You can see we have twelve of twelve seats used.\n\nI click Invite member, type her email, and when I press Send invite the dialog just closes. Nothing happened. No error, no email. Pending invites still says two.\n\nI think it’s because we’re out of seats, and it should say so. What I’d expect is a clear message that the invite wasn’t sent, with a way to add a seat from the same dialog.',
  },
  {
    duration: 310,
    silence: 12,
    filler: 4,
    transcript:
      'This is the billing page review. We hit the seat limit again on staging, so I want to walk through what an owner sees when that happens.\n\nThe upgrade plan dialog shows the seat count. It tells you how many seats are in use, but not which plan gives you more. We should explain which plan includes more seats before asking anyone to pay.\n\nNext steps: add the plan comparison to this dialog, and link to it from the Members page where the limit is first hit.',
  },
  {
    duration: 522,
    silence: 20,
    filler: 8,
    transcript:
      'Welcome to the onboarding walkthrough. First create a workspace, then invite your team. This takes about a minute.\n\nSeats are counted per workspace, so check how many are free before you invite a large group. Check pending invites to confirm that the invitation was sent.\n\nOnce your team has joined, share your first project from the Projects page. That’s everything you need to get started.',
  },
];
recordings.forEach((r, i) =>
  Object.assign(r, details[i], {
    createdAt: Date.UTC(2026, 10, 13 - i * 2, 9, 30),
    status: 'ready',
    trim: 0,
    chips: [],
    marks: [
      { at: 0, text: 'Introduction' },
      {
        at: Math.round(details[i].duration * 0.4),
        text: i === 0 ? 'Invite fails' : 'Key moment',
      },
      { at: Math.round(details[i].duration * 0.8), text: 'Next steps' },
    ],
  }),
);
recordings.push({
  id: 'r4',
  title: 'Weekly product update',
  createdAt: Date.UTC(2026, 10, 6, 11),
  status: 'error',
  duration: 185,
  meta: '6 Nov · 3:05',
  silence: 0,
  filler: 0,
  transcript:
    'This week we reviewed the recording flow and agreed on the next steps. Make the recording state clear, then improve the library and editor.',
  marks: [],
  trim: 0,
  chips: [],
});
module.exports = { recordings, moments };
