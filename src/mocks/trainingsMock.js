// Имена тренеров — личные имена, не переводятся.
// groupKey указывает на ключ перевода в неймспейсе groups.*.
// date — ISO-дата, форматируется через utils/formatters.js (Intl), не хранится строкой.
export const trainingsMock = {
  leon: [
    {
      id: 't1',
      date: '2026-05-21',
      startTime: '17:30',
      endTime: '18:30',
      groupKey: 'groups.children8to12',
      roomNumber: 1,
      trainer: 'Томас Бауэр',
      enrolled: true
    },
    {
      id: 't2',
      date: '2026-05-24',
      startTime: '10:00',
      endTime: '11:00',
      groupKey: 'groups.physicalTraining',
      roomNumber: 2,
      trainer: 'Томас Бауэр',
      enrolled: false
    }
  ],
  anna: [
    {
      id: 't3',
      date: '2026-05-23',
      startTime: '16:00',
      endTime: '17:00',
      groupKey: 'groups.toddlers5to7',
      roomNumber: 1,
      trainer: 'Мария Шульц',
      enrolled: true
    }
  ]
};
