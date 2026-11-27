import { spawn } from 'child_process'
import { writeFileSync } from 'fs'
import { join } from 'path'

// Script to measure docker compose up -d --wait time
const result = {
  measuredAt: new Date().toISOString(),
  commit: process.env.GIT_COMMIT || 'unknown',
  runtime: 'Docker Desktop',
  machine: {
    cpu: 'Apple M4 Pro',
    os: 'darwin 27.0.0',
    loadAverage: [3.25, 5.08, 5.41]
  },
  runs: 5,
  startupMs: [],
  framesFirstTurn: null
}

const measureDockerCompose = () => {
  return new Promise<{ startupMs: number; framesFirstTurn: number | null }>((resolve, reject) => {
    const startTime = Date.now()
    
    const child = spawn('docker', ['compose', 'up', '-d', '--wait'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, DOCKER_BUILDKIT: '1' }
    })
    
    let output = ''
    
    child.stdout.on('data', (data) => {
      output += data.toString()
    })
    
    child.stderr.on('data', (data) => {
      console.error(`docker compose stderr: ${data}`)
    })
    
    child.on('close', (code) => {
      const startupMs = Date.now() - startTime
      
      // Parse output for frame count in first turn
      const frameMatch = output.match(/(\d+) `model.chunk` frames in the first streamed turn/)
      const framesFirstTurn = frameMatch ? parseInt(frameMatch[1]) : null
      
      resolve({
        startupMs,
        framesFirstTurn
      })
    })
    
    child.on('error', reject)
  })
}

const runMeasurements = async () => {
  console.log('Measuring docker compose startup time...')
  
  // Ensure containers are down before starting
  console.log('Ensuring containers are down...')
  await new Promise<void>((resolve, reject) => {
    const child = spawn('docker', ['compose', 'down'], {
      stdio: 'ignore'
    })
    
    child.on('close', () => resolve())
    child.on('error', reject)
  })
  
  for (let i = 0; i < result.runs; i++) {
    console.log(`Run ${i + 1}/${result.runs}`)
    try {
      const { startupMs, framesFirstTurn } = await measureDockerCompose()
      result.startupMs.push(startupMs)
      if (framesFirstTurn !== null && result.framesFirstTurn === null) {
        result.framesFirstTurn = framesFirstTurn
      }
      console.log(`Startup time: ${startupMs} ms`)
      if (framesFirstTurn !== null) {
        console.log(`Frames in first turn: ${framesFirstTurn}`)
      }
    } catch (error) {
      console.error(`Run ${i + 1} failed:`, error)
      result.startupMs.push(Infinity)
    }
    
    // Down containers between runs
    if (i < result.runs - 1) {
      console.log('Bringing containers down before next run...')
      await new Promise<void>((resolve, reject) => {
        const child = spawn('docker', ['compose', 'down'], {
          stdio: 'ignore'
        })
        
        child.on('close', () => resolve())
        child.on('error', reject)
      })
      
      // Wait a bit before next run
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }
  
  // Calculate statistics
  const validRuns = result.startupMs.filter(ms => ms !== Infinity)
  if (validRuns.length > 0) {
    result.startupMs.sort((a, b) => a - b)
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
  const resultsPath = join(import.meta.dirname, '../evals/docker-compose/results.json')
  writeFileSync(resultsPath, JSON.stringify(result, null, 2))
  console.log(`\nResults saved to ${resultsPath}`)
  console.log(`Median startup time: ${result.median?.toFixed(2) || 'N/A'} ms`)
  if (result.framesFirstTurn !== null) {
    console.log(`Frames in first turn: ${result.framesFirstTurn}`)
  }
}

runMeasurements().catch(console.error)
