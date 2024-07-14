export function secToTime(seconds: number) {
  const minutes = Math.floor((seconds / 60) % 60)
  const hours = Math.floor((seconds / 60 / 60) % 24)
  seconds = Math.floor(seconds) % 60

  return [
    hours.toString().padStart(2, '0') + 'h',
    minutes.toString().padStart(2, '0') + 'm',
    seconds.toString().padStart(2, '0') + 's',
  ].join(':')
}
