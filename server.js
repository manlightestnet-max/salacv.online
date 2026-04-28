const express = require('express')
const path = require('path')
const app = express()

app.use(express.static(path.join(__dirname, 'public')))

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'smlab-landing' })
})

const PORT = process.env.PORT || 80
app.listen(PORT, () => {
  console.log(`smlab running on port ${PORT}`)
})
