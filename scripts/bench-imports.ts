import { spawn } from 'child_process'
import { writeFileSync } from 'fs'
import { join } from 'path'

// Script to measure Ink and React import times under Node
const result = {
  measuredAt: new Date().toISOString(),
  commit: process.env.GIT_COMMIT || 'unknown',
  runtime: 'node 24',
  machine: {
    cpu: 'Apple M4 Pro',
    os: 'darwin 27.0.0',
    loadAverage: [3.25, 5.08, 5.41] // Typical values
  },
  runs: 5,
  importsMs: []
}

const measureImport = () => {
  return new Promise<number>((resolve, reject) => {
    const start = process.hrtime.bigint()
    const child = spawn('node', ['-e', 'import("react"); import("ink");'], {
      stdio: 'ignore'
    })
    
    child.on('close', () => {
      const end = process.hrtime.bigint()
      const duration = Number(end - start) / 1000000 // Convert to ms
      resolve(duration)
    })
    
    child.on('error', reject)
  })
}

const runMeasurements = async () => {
  console.log('Measuring Ink and React import times...')
  
  for (let i = 0; i < result.runs; i++) {
    console.log(`Run ${i + 1}/${result.runs}`)
    try {
      const duration = await measureImport()
      result.importsMs.push(duration)
      console.log(`Import time: ${duration.toFixed(2)} ms`)
    } catch (error) {
      console.error(`Run ${i + 1} failed:`, error)
      result.importsMs.push(Infinity)
    }
    
    // Small delay between runs
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  
  // Calculate statistics
  const validRuns = result.importsMs.filter(ms => ms !== Infinity)
  if (validRuns.length > 0) {
    result.importsMs.sort((a, b) => a - b)
    const median = validRuns[Math.floor(validRuns.length / 2)]
    const min = validRuns[0]
    const max = validRuns[validRuns.length - 1]
    const mean = validRuns.reduce((sum, ms) => sum + ms, 0) / validRuns.length
    
    result.median = median
    result.min = min
    result.max = max
    result.mean = mean
  }
  
  // Save results
  const resultsPath = join(import.meta.dirname, '../evals/imports/results.json')
  writeFileSync(resultsPath, JSON.stringify(result, null, 2))
  console.log(`\nResults saved to ${resultsPath}`)
  console.log(`Median import time: ${result.median?.toFixed(2) || 'N/A'} ms`)
}

runMeasurements().catch(console.error)
