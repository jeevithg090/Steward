---
name: replace-with-hooks
description: transform a class component into a function component using hooks for state and effects
---

1. rewrite the component as a function declaration. 2. add 'useState' and 'useEffect' to the import list if not present. 3. replace 'state = this.state' with 'const [state, setState] = useState(initialValue)'. 4. replace 'this.setState' with 'setState'. 5. replace lifecycle methods with useEffect hooks: componentDidMount becomes useEffect with empty dependency array, componentDidUpdate becomes useEffect with updated dependencies, componentWillUnmount becomes useEffect with cleanup function. 6. remove the render method and return the jsx directly from the function body.
