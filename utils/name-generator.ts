const FIRST_NAMES = ['Asha', 'Ben', 'Chloe', 'Dev', 'Elena', 'Farid', 'Grace', 'Hugo'];
const LAST_NAMES = ['Kapoor', 'Smith', 'Jansen', 'Garcia', 'Novak', 'Okafor', 'Rossi', 'Tanaka'];

function pick(list: string[]): string {
  return list[Math.floor(Math.random() * list.length)];
}

export function randomFirstName(): string {
  return pick(FIRST_NAMES);
}

export function randomLastName(): string {
  return pick(LAST_NAMES);
}
