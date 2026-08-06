// Личные имена (firstName/lastName) не переводятся.
// beltKey указывает на ключ перевода в neймспейсе belts.*.
export const childrenMock = [
  {
    id: 'leon',
    firstName: 'Леон',
    lastName: 'Мюллер',
    age: 10,
    birthYear: 2015,
    photoUrl: null,
    currentBelt: { key: 'belts.yellow', color: '#f2d13c' },
    nextBelt: { key: 'belts.orange', color: '#e08a3c' },
    ageEligibility: {
      achieved: true,
      currentAge: 10,
      requiredAge: 8
    },
    rating: {
      current: 720,
      total: 1000
    }
  },
  {
    id: 'anna',
    firstName: 'Анна',
    lastName: 'Мюллер',
    age: 7,
    birthYear: 2018,
    photoUrl: null,
    currentBelt: { key: 'belts.white', color: '#f5f5f6' },
    nextBelt: { key: 'belts.yellow', color: '#f2d13c' },
    ageEligibility: {
      achieved: false,
      currentAge: 7,
      requiredAge: 12,
      remainingYears: 5
    },
    rating: {
      current: 450,
      total: 1000
    }
  }
];
