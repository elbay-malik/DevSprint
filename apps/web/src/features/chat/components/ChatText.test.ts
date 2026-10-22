import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ChatText from './ChatText.vue'

describe('ChatText', () => {
  it('shows bold and bullets as formatting, not as raw markers', () => {
    const wrapper = mount(ChatText, {
      props: { text: '**Ben’s open issues**\n- DS-7 in review\n- DS-9 in progress' },
    })
    expect(wrapper.get('strong').text()).toBe('Ben’s open issues')
    expect(wrapper.findAll('li')).toHaveLength(2)
    expect(wrapper.text()).not.toContain('**')
  })

  it('escapes markup a model repeats from the board, instead of running it', () => {
    // Text on the public board reaches the model verbatim (ADR-0016); if it
    // quotes it back, it must arrive as characters.
    const wrapper = mount(ChatText, {
      props: { text: '**<img src=x onerror=alert(1)>** <script>alert(2)</script>' },
    })
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.text()).toContain('<script>alert(2)</script>')
    expect(wrapper.get('strong').text()).toBe('<img src=x onerror=alert(1)>')
  })

  it('breaks a table cell where the model wrote <br>, without rendering markup', () => {
    const wrapper = mount(ChatText, {
      props: { text: '| Who | Issues |\n|---|---|\n| Ben | DS-7 <br> DS-9 <br onclick=x> |' },
    })
    const cell = wrapper.findAll('td')[1]
    expect(cell?.findAll('br')).toHaveLength(1)
    expect(cell?.text()).not.toContain('<br>')
    expect(cell?.text()).toContain('<br onclick=x>')
    expect(cell?.find('[onclick]').exists()).toBe(false)
  })

  it('never turns link syntax into a link', () => {
    const wrapper = mount(ChatText, { props: { text: 'See [the docs](https://evil.example)' } })
    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.text()).toContain('[the docs](https://evil.example)')
  })

  it('renders a table the model writes as a table', () => {
    const wrapper = mount(ChatText, {
      props: { text: '| Key | Status |\n|---|---|\n| DS-7 | **Done** |' },
    })
    expect(wrapper.findAll('th').map((cell) => cell.text())).toEqual(['Key', 'Status'])
    expect(wrapper.get('td strong').text()).toBe('Done')
  })
})
