function collectionMenu(collection, act) {
  const editable = !collection.bloom && !collection.pendingOperation;
  return [
    { label: 'Open', click: () => act('open') },
    { label: 'Rename…', enabled: editable, click: () => act('rename') },
    { label: 'Copy collection ID', click: () => act('copy-id') },
    ...(collection.pendingOperation
      ? [{ label: 'Check previous change', click: () => act('reconcile') }]
      : []),
    { type: 'separator' },
    {
      label: 'Delete collection…',
      enabled: editable,
      click: () => act('delete'),
    },
    ...(collection.bloom
      ? [{ label: 'Recording destination', enabled: false }]
      : []),
  ];
}

module.exports = { collectionMenu };
