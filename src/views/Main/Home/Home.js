import React, { PropTypes as T } from 'react'
import {Button} from 'react-bootstrap'
import AuthService from 'utils/AuthService'
import styles from './styles.module.css'

import NumericInput from 'react-numeric-input';

export class Home extends React.Component {
  static contextTypes = {
    router: T.object
  }

  static propTypes = {
    auth: T.instanceOf(AuthService)
  }

  constructor(props, context) {
    super(props, context)
    this.state = {
      profile: props.auth.getProfile()
    }
    props.auth.on('profile_updated', (newProfile) => {
      this.setState({profile: newProfile})
    })
  }

  logout(){
    this.props.auth.logout()
    this.context.router.push('/login');
  }

  render(){
    const { profile } = this.state

    return (
      <div>
        <div className={styles.root}>
          <p>Welcome {profile.name}! Vote Wisely.</p>

          <div className={styles.root}>
            <div>
              <h4>Jill Stein</h4>
              <NumericInput min={0} max={100} value={0} style={{
                input: {
                    color: 'red'
                }
              }}/>
              <NumericInput min={0} max={100} value={0} style={{
                input: {
                    color: 'blue'
                }
              }}/>
            </div>
            <div>
              <h4>Gary Johnson</h4>
              <NumericInput min={0} max={100} value={0} style={{
                input: {
                    color: 'red'
                }
              }}/>
              <NumericInput min={0} max={100} value={0} style={{
                input: {
                    color: 'blue'
                }
              }}/>
            </div>
            <div>
              <h4>Hillary Clinton</h4>
              <NumericInput min={0} max={100} value={0} style={{
                input: {
                    color: 'red'
                }
              }}/>
              <NumericInput min={0} max={100} value={0} style={{
                input: {
                    color: 'blue'
                }
              }}/>
              <p/>
            </div>
            <div>
              <h4>Donald Trump</h4>
              <NumericInput min={0} max={100} value={0} style={{
                input: {
                    color: 'red'
                }
              }}/>
              <NumericInput min={0} max={100} value={0} style={{
                input: {
                    color: 'blue'
                }
              }}/>
              <p/>
            </div>
          </div>

          <Button onClick={this.logout.bind(this)}>Submit Vote</Button>

          <Button onClick={this.logout.bind(this)}>Logout</Button>
        </div>
      </div>
    )
  }
}

export default Home;
